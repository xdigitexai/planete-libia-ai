import type { FastifyInstance } from "fastify";
import { randomInt } from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import * as OTP from "otpauth";
import {
  db,
  auth,
  session,
  self,
  hash,
  token,
  password,
  fail,
  seal,
  unseal,
  idParam,
} from "./core.js";
import type { CodeProvider } from "./providers.js";
import { registrationSchema } from "./validation.js";
export function authRoutes(app: FastifyInstance, codes: CodeProvider) {
  const limit = { config: { rateLimit: { max: 8, timeWindow: "15 minutes" } } };
  const cookie = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
  };
  async function sendCode(userId: string) {
    const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
    const code = String(randomInt(100000, 1000000));
    const now = new Date();
    const reserved = await db.verification.updateMany({
      where: { userId, sentAt: { lt: new Date(Date.now() - 60000) } },
      data: {
        codeHash: hash(code),
        sentAt: now,
        expiresAt: new Date(Date.now() + 600000),
        attempts: 0,
      },
    });
    if (!reserved.count)
      fail(429, "Veuillez attendre 60 secondes avant de renvoyer le code.");
    try {
      await codes.send(u, code);
    } catch (e) {
      await db.verification.updateMany({
        where: { userId, codeHash: hash(code) },
        data: { expiresAt: new Date(0), sentAt: new Date(0) },
      });
      throw e;
    }
  }
  app.post("/api/auth/register", limit, async (r, reply) => {
    const b = registrationSchema.parse(r.body);
    const { password: pw, confirmPassword: _confirmPassword, ...data } = b;
    const u = await db.user.create({
      data: {
        ...data,
        passwordHash: await bcrypt.hash(pw, 12),
        verification: {
          create: {
            codeHash: hash(token()),
            sentAt: new Date(0),
            expiresAt: new Date(0),
          },
        },
      },
    });
    let delivery = "sent";
    try {
      await sendCode(u.id);
    } catch {
      delivery = "unavailable";
    }
    reply.code(201);
    return {
      id: u.id,
      delivery,
      message:
        delivery === "sent"
          ? "Code envoyé."
          : "Compte créé. L’envoi du code est indisponible ; réessayez après configuration du service.",
    };
  });
  app.post("/api/auth/resend", limit, async (r) => {
    const { login } = z.object({ login: z.string().max(254) }).parse(r.body);
    const u = await db.user.findFirst({
      where: {
        OR: [
          { id: login },
          { email: login.toLowerCase() },
          { phone: login },
          { username: login.toLowerCase() },
        ],
      },
    });
    if (u && !u.verifiedAt) await sendCode(u.id);
    return { ok: true };
  });
  app.post("/api/auth/verify", limit, async (r) => {
    const b = z
      .object({ login: z.string().max(254), code: z.string().regex(/^\d{6}$/) })
      .parse(r.body);
    const u = await db.user.findFirst({
      where: {
        OR: [
          { id: b.login },
          { email: b.login.toLowerCase() },
          { phone: b.login },
          { username: b.login.toLowerCase() },
        ],
      },
    });
    if (!u) fail(400, "Code invalide ou expiré.");
    const v = await db.verification.findUnique({ where: { userId: u!.id } });
    if (!v || v.expiresAt < new Date() || v.attempts >= 5)
      fail(400, "Code invalide ou expiré.");
    const claimed = await db.verification.updateMany({
      where: {
        userId: u!.id,
        attempts: { lt: 5 },
        expiresAt: { gt: new Date() },
      },
      data: { attempts: { increment: 1 } },
    });
    if (!claimed.count || v!.codeHash !== hash(b.code))
      fail(400, "Code invalide ou expiré.");
    await db.$transaction([
      db.user.update({
        where: { id: u!.id },
        data: { verifiedAt: new Date() },
      }),
      db.verification.update({
        where: { userId: u!.id },
        data: { expiresAt: new Date(0) },
      }),
    ]);
    return { ok: true };
  });
  app.post("/api/auth/login", limit, async (r, reply) => {
    const b = z
      .object({
        login: z.string().max(254),
        password: z.string().max(72),
        otp: z.string().optional(),
      })
      .parse(r.body);
    const u = await db.user.findFirst({
      where: {
        OR: [
          { email: b.login.toLowerCase() },
          { phone: b.login },
          { username: b.login.toLowerCase() },
        ],
      },
    });
    const valid = await bcrypt.compare(
      b.password,
      u?.passwordHash ||
        "$2b$12$qqqqqqqqqqqqqqqqqqqqquIP3v8AHIeSoFSzbm2onVSUiZncLGBCW",
    );
    if (!u || !valid || u.status !== "ACTIVE")
      fail(401, "Identifiants invalides.");
    if (!u!.verifiedAt) fail(403, "Vérifiez votre compte avant la connexion.");
    if (
      u!.totpEnabled &&
      (!b.otp ||
        new OTP.TOTP({ secret: unseal(u!.totpSecret!) }).validate({
          token: b.otp,
          window: 1,
        }) === null)
    )
      fail(401, "Code 2FA requis ou invalide.");
    const raw = token();
    const expiresAt = new Date(Date.now() + 7 * 86400000);
    await db.session.create({
      data: {
        userId: u!.id,
        refreshHash: hash(raw),
        expiresAt,
        userAgent: String(r.headers["user-agent"] || "").slice(0, 300),
      },
    });
    reply.setCookie("pl_session", raw, { ...cookie, expires: expiresAt });
    return self(u!);
  });
  app.get("/api/me", async (r) => {
    const u = await auth(r);
    const counts = await db.user.findUniqueOrThrow({
      where: { id: u.id },
      select: {
        _count: {
          select: {
            memberships: { where: { room: { kind: "GROUP" } } },
            contacts: true,
            articles: { where: { publishedAt: { not: null } } },
          },
        },
      },
    });
    return { ...self(u), stats: counts._count };
  });
  app.post("/api/auth/logout", async (r, reply) => {
    const s = await session(r.cookies.pl_session);
    await db.session.update({
      where: { id: s.id },
      data: { revokedAt: new Date() },
    });
    app.io.in(`session:${s.id}`).disconnectSockets();
    reply.clearCookie("pl_session", cookie);
    return { ok: true };
  });
  app.get("/api/sessions", async (r) => {
    const s = await session(r.cookies.pl_session);
    return (
      await db.session.findMany({
        where: {
          userId: s.userId,
          revokedAt: null,
          expiresAt: { gt: new Date() },
        },
        select: { id: true, userAgent: true, createdAt: true, expiresAt: true },
      })
    ).map((v) => ({ ...v, current: v.id === s.id }));
  });
  app.delete("/api/sessions/:id", async (r) => {
    const u = await auth(r);
    await db.session.updateMany({
      where: { id: idParam(r), userId: u.id },
      data: { revokedAt: new Date() },
    });
    app.io.in(`session:${idParam(r)}`).disconnectSockets();
    return { ok: true };
  });
  app.post("/api/security/password", limit, async (r) => {
    const u = await auth(r);
    const b = z.object({ current: z.string().max(72), password }).parse(r.body);
    const initialGooglePassword = u.passwordHash === "!" && !!u.googleSubject;
    if (initialGooglePassword) {
      const s = await session(r.cookies.pl_session);
      if (s.createdAt < new Date(Date.now() - 600000))
        fail(
          403,
          "Reconnectez-vous avec Google avant de créer votre mot de passe.",
        );
    } else if (!(await bcrypt.compare(b.current, u.passwordHash)))
      fail(403, "Mot de passe incorrect.");
    await db.$transaction([
      db.user.update({
        where: { id: u.id },
        data: { passwordHash: await bcrypt.hash(b.password, 12) },
      }),
      db.session.updateMany({
        where: { userId: u.id },
        data: { revokedAt: new Date() },
      }),
    ]);
    app.io.in(`user:${u.id}`).disconnectSockets();
    return { ok: true };
  });
  app.post("/api/security/2fa/setup", async (r) => {
    const u = await auth(r);
    if (u.totpEnabled) fail(409, "2FA déjà activée.");
    const t = new OTP.TOTP({ issuer: "PLANÈTE LIBIA AI", label: u.email });
    await db.user.update({
      where: { id: u.id },
      data: { totpSecret: seal(t.secret.base32) },
    });
    return { uri: t.toString(), secret: t.secret.base32 };
  });
  app.post("/api/security/2fa/confirm", limit, async (r) => {
    const u = await auth(r);
    const { code } = z.object({ code: z.string().length(6) }).parse(r.body);
    if (
      !u.totpSecret ||
      new OTP.TOTP({ secret: unseal(u.totpSecret) }).validate({
        token: code,
        window: 1,
      }) === null
    )
      fail(400, "Code invalide.");
    await db.user.update({ where: { id: u.id }, data: { totpEnabled: true } });
    return { ok: true };
  });
  app.post("/api/security/2fa/disable", limit, async (r) => {
    const u = await auth(r);
    const b = z
      .object({ password: z.string(), code: z.string() })
      .parse(r.body);
    if (
      !(await bcrypt.compare(b.password, u.passwordHash)) ||
      !u.totpSecret ||
      new OTP.TOTP({ secret: unseal(u.totpSecret) }).validate({
        token: b.code,
        window: 1,
      }) === null
    )
      fail(403, "Vérification refusée.");
    await db.user.update({
      where: { id: u.id },
      data: { totpEnabled: false, totpSecret: null },
    });
    return { ok: true };
  });
}
