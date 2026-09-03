import { PrismaClient, type User } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import {
  createHash,
  randomBytes,
  createCipheriv,
  createDecipheriv,
} from "node:crypto";
import { z } from "zod";
export const db = new PrismaClient();
export const hash = (v: string) => createHash("sha256").update(v).digest("hex");
export const token = () => randomBytes(32).toString("base64url");
export class Fault extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const fail = (status: number, message: string): never => {
  throw new Fault(status, message);
};
export const password = z
  .string()
  .min(12)
  .max(72)
  .regex(/[a-z]/)
  .regex(/[A-Z]/)
  .regex(/[0-9]/)
  .regex(/[^a-zA-Z0-9]/);
export const idParam = (r: FastifyRequest) =>
  z.object({ id: z.string().min(1).max(100) }).parse(r.params).id;
export const page = (r: FastifyRequest) => {
  const q = z
    .object({
      page: z.coerce.number().int().min(1).max(10000).default(1),
      q: z.string().max(100).default(""),
    })
    .parse(r.query);
  return { skip: (q.page - 1) * 30, take: 30, q: q.q };
};
export const publicUser = {
  id: true,
  name: true,
  username: true,
  bio: true,
  avatarId: true,
  showPresence: true,
} as const;
export function self(u: User) {
  const {
    passwordHash: _passwordHash,
    totpSecret: _totpSecret,
    googleSubject: _googleSubject,
    ...safe
  } = u;
  return {
    ...safe,
    googleLinked: !!_googleSubject,
    passwordLogin: _passwordHash !== "!",
  };
}
export async function session(raw?: string) {
  if (!raw) return fail(401, "Connexion requise.");
  const s = await db.session.findUnique({
    where: { refreshHash: hash(raw) },
    include: { user: true },
  });
  if (
    !s ||
    s.revokedAt ||
    s.expiresAt < new Date() ||
    s.user.status !== "ACTIVE" ||
    !s.user.verifiedAt
  )
    return fail(401, "Session expirée.");
  return s;
}
export async function auth(r: FastifyRequest) {
  return (await session(r.cookies.pl_session)).user;
}
export async function admin(r: FastifyRequest) {
  const u = await auth(r);
  if (u.role !== "ADMIN") fail(403, "Accès administrateur requis.");
  if (process.env.NODE_ENV === "production" && !u.totpEnabled)
    fail(
      403,
      "Activez la 2FA dans les paramètres avant d’administrer la plateforme.",
    );
  return u;
}
export async function blocked(a: string, b: string) {
  return !!(await db.block.findFirst({
    where: {
      OR: [
        { userId: a, targetId: b },
        { userId: b, targetId: a },
      ],
    },
  }));
}
export async function member(userId: string, roomId: string, manage = false) {
  const m = await db.member.findUnique({
    where: { roomId_userId: { roomId, userId } },
    include: { room: { include: { members: true } } },
  });
  if (!m) return fail(404, "Discussion introuvable.");
  if (manage && (m.room.kind !== "GROUP" || m.role === "MEMBER"))
    fail(403, "Droits de gestion requis.");
  if (m.room.kind === "PRIVATE")
    for (const other of m.room.members)
      if (other.userId !== userId && (await blocked(userId, other.userId)))
        fail(403, "Interaction indisponible.");
  return m;
}
export async function audit(actorId: string, action: string, target: string) {
  await db.auditLog.create({ data: { actorId, action, target } });
}
export function seal(text: string) {
  const key = Buffer.from(process.env.TOTP_ENCRYPTION_KEY || "", "hex");
  if (key.length !== 32) fail(503, "Sécurité 2FA non configurée.");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  return Buffer.concat([
    iv,
    c.update(text),
    c.final(),
    c.getAuthTag(),
  ]).toString("base64");
}
export function unseal(text: string) {
  const b = Buffer.from(text, "base64");
  const d = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(process.env.TOTP_ENCRYPTION_KEY || "", "hex"),
    b.subarray(0, 12),
  );
  d.setAuthTag(b.subarray(-16));
  return Buffer.concat([d.update(b.subarray(12, -16)), d.final()]).toString();
}
export async function storedOpenAiKey() {
  const setting = await db.setting.findUnique({ where: { key: "_secret.openai" } });
  const encrypted = (setting?.value as { encrypted?: unknown } | null)?.encrypted;
  if (typeof encrypted !== "string") return null;
  try {
    return unseal(encrypted);
  } catch {
    fail(503, "La clé OpenAI enregistrée ne peut pas être déchiffrée.");
  }
}
export async function hasStoredOpenAiKey() {
  return !!(await db.setting.findUnique({ where: { key: "_secret.openai" }, select: { key: true } }));
}
