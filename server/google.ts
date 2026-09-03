import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { createHash } from "node:crypto";
import {
  EncryptJWT,
  jwtDecrypt,
  jwtVerify,
  createRemoteJWKSet,
  type JWTVerifyGetKey,
} from "jose";
import { z } from "zod";
import * as OTP from "otpauth";
import { db, token, hash, fail, session, unseal } from "./core.js";
import { profileFields } from "./validation.js";
export type GoogleIdentity = { subject: string; email: string; name: string };
export interface GoogleProvider {
  exchange(
    code: string,
    verifier: string,
    nonce: string,
  ): Promise<GoogleIdentity>;
}
const googleKeys = createRemoteJWKSet(
  new URL("https://www.googleapis.com/oauth2/v3/certs"),
);
export async function verifyGoogleIdToken(
  raw: string,
  nonce: string,
  keys: JWTVerifyGetKey = googleKeys,
): Promise<GoogleIdentity> {
  const { payload } = await jwtVerify(raw, keys, {
    issuer: ["https://accounts.google.com", "accounts.google.com"],
    audience: process.env.GOOGLE_CLIENT_ID,
    algorithms: ["RS256"],
    requiredClaims: ["exp", "iat", "sub", "email", "nonce"],
  });
  if (payload.nonce !== nonce || payload.email_verified !== true)
    fail(401, "Identité Google non vérifiée.");
  return {
    subject: z.string().min(1).max(255).parse(payload.sub),
    email: z.email().parse(payload.email).toLowerCase(),
    name: typeof payload.name === "string" ? payload.name.slice(0, 80) : "",
  };
}
export class ConfiguredGoogle implements GoogleProvider {
  async exchange(code: string, verifier: string, nonce: string) {
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: process.env.GOOGLE_CLIENT_ID!,
        client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        redirect_uri: redirectUri(),
        grant_type: "authorization_code",
        code_verifier: verifier,
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok)
      fail(502, "Google n’a pas pu confirmer cette connexion. Réessayez.");
    const result = z.object({ id_token: z.string() }).parse(await res.json());
    return verifyGoogleIdToken(result.id_token, nonce);
  }
}
function redirectUri() {
  return `${process.env.APP_ORIGIN || "http://localhost:5173"}/api/auth/google/callback`;
}
function configured() {
  return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}
function key() {
  if (!configured())
    fail(
      503,
      "La connexion Google n’est pas encore configurée. L’administrateur doit ajouter les identifiants Google OAuth.",
    );
  return createHash("sha256")
    .update(process.env.GOOGLE_CLIENT_SECRET!)
    .digest();
}
const cookie = () => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/api/auth/google",
  maxAge: 600,
});
async function ticket(data: Record<string, unknown>) {
  return new EncryptJWT(data)
    .setProtectedHeader({ alg: "dir", enc: "A256GCM" })
    .setIssuer("planete-libia")
    .setAudience("google-auth")
    .setIssuedAt()
    .setExpirationTime("10m")
    .encrypt(key());
}
async function readTicket(raw: string | undefined, purpose: string) {
  if (!raw) fail(401, "Cette connexion Google a expiré. Recommencez.");
  const { payload } = await jwtDecrypt(raw!, key(), {
    issuer: "planete-libia",
    audience: "google-auth",
    keyManagementAlgorithms: ["dir"],
    contentEncryptionAlgorithms: ["A256GCM"],
  });
  if (payload.purpose !== purpose) fail(401, "Connexion Google invalide.");
  return payload;
}
async function signIn(userId: string, r: FastifyRequest, reply: FastifyReply) {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  if (u.status !== "ACTIVE" || !u.verifiedAt)
    fail(403, "Ce compte n’est pas disponible.");
  const raw = token(),
    expiresAt = new Date(Date.now() + 7 * 86400000);
  await db.session.create({
    data: {
      userId,
      refreshHash: hash(raw),
      expiresAt,
      userAgent: String(r.headers["user-agent"] || "").slice(0, 300),
    },
  });
  reply.setCookie("pl_session", raw, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  reply.clearCookie("pl_google_pending", cookie());
}
export function googleRoutes(
  app: FastifyInstance,
  provider: GoogleProvider = new ConfiguredGoogle(),
) {
  const limited = {
    config: { rateLimit: { max: 10, timeWindow: "15 minutes" } },
  };
  app.post("/api/auth/google/start", limited, async (r, reply) => {
    key();
    const { link } = z
      .object({ link: z.boolean().default(false) })
      .parse(r.body || {});
    const current = link ? await session(r.cookies.pl_session) : null;
    const state = token(),
      nonce = token(),
      verifier = token();
    reply.setCookie(
      "pl_google_flow",
      await ticket({
        purpose: "flow",
        state,
        nonce,
        verifier,
        linkUserId: current?.userId,
        linkSessionId: current?.id,
      }),
      cookie(),
    );
    const query = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID!,
      redirect_uri: redirectUri(),
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return { url: `https://accounts.google.com/o/oauth2/v2/auth?${query}` };
  });
  app.get("/api/auth/google/callback", limited, async (r, reply) => {
    try {
      const q = z
        .object({
          state: z.string(),
          code: z.string().optional(),
          error: z.string().optional(),
        })
        .parse(r.query);
      const flow = await readTicket(r.cookies.pl_google_flow, "flow");
      reply.clearCookie("pl_google_flow", cookie());
      if (q.state !== flow.state) fail(401, "État Google invalide.");
      if (q.error || !q.code)
        return reply.redirect("/connexion?google_error=cancelled");
      const identity = await provider.exchange(
        q.code,
        flow.verifier as string,
        flow.nonce as string,
      );
      if (flow.linkUserId) {
        const s = await session(r.cookies.pl_session);
        if (
          s.userId !== flow.linkUserId ||
          s.id !== flow.linkSessionId ||
          s.user.email !== identity.email
        )
          fail(403, "Association refusée.");
        await db.user.update({
          where: { id: s.userId },
          data: { googleSubject: identity.subject },
        });
        return reply.redirect("/parametres");
      }
      const u = await db.user.findUnique({
        where: { googleSubject: identity.subject },
      });
      if (u) {
        if (u.status !== "ACTIVE" || !u.verifiedAt)
          return reply.redirect("/connexion?google_error=unavailable");
        if (u.totpEnabled) {
          reply.setCookie(
            "pl_google_pending",
            await ticket({
              purpose: "pending",
              mode: "mfa",
              userId: u.id,
              subject: identity.subject,
            }),
            cookie(),
          );
          return reply.redirect("/google/terminer");
        }
        await signIn(u.id, r, reply);
        return reply.redirect("/accueil");
      }
      if (await db.user.findUnique({ where: { email: identity.email } }))
        return reply.redirect("/connexion?google_error=email_exists");
      reply.setCookie(
        "pl_google_pending",
        await ticket({ purpose: "pending", mode: "signup", ...identity }),
        cookie(),
      );
      return reply.redirect("/google/terminer");
    } catch {
      reply.clearCookie("pl_google_flow", cookie());
      return reply.redirect("/connexion?google_error=failed");
    }
  });
  app.get("/api/auth/google/pending", async (r) => {
    const pending = await readTicket(r.cookies.pl_google_pending, "pending");
    return { mode: pending.mode, email: pending.email, name: pending.name };
  });
  app.post("/api/auth/google/complete", limited, async (r, reply) => {
    const pending = await readTicket(r.cookies.pl_google_pending, "pending");
    let userId: string;
    if (pending.mode === "mfa") {
      const { otp } = z
        .object({
          otp: z
            .string()
            .regex(/^\d{6}$/, "Saisissez le code 2FA à six chiffres."),
        })
        .parse(r.body);
      const u = await db.user.findUnique({
        where: { id: pending.userId as string },
      });
      if (
        !u ||
        u.googleSubject !== pending.subject ||
        !u.totpEnabled ||
        !u.totpSecret ||
        new OTP.TOTP({ secret: unseal(u.totpSecret) }).validate({
          token: otp,
          window: 1,
        }) === null
      )
        fail(401, "Code 2FA invalide.");
      userId = u!.id;
    } else if (pending.mode === "signup") {
      const profile = z.object(profileFields).parse(r.body);
      const u = await db.user.create({
        data: {
          ...profile,
          email: pending.email as string,
          googleSubject: pending.subject as string,
          passwordHash: "!",
          verifiedAt: new Date(),
        },
      });
      userId = u.id;
    } else return fail(401, "Connexion Google invalide.");
    await signIn(userId, r, reply);
    return { ok: true };
  });
}
