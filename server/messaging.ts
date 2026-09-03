import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  db,
  auth,
  member,
  blocked,
  fail,
  idParam,
  page,
  publicUser,
} from "./core.js";
import { sendPush } from "./push.js";
export async function notify(
  app: FastifyInstance,
  userId: string,
  category: string,
  title: string,
  path: string,
) {
  const u = await db.user.findUnique({ where: { id: userId } });
  if (
    !u ||
    u.status !== "ACTIVE" ||
    (u.preferences as Record<string, unknown>)[category] === false
  )
    return;
  const n = await db.notification.create({
    data: { userId, category, title, path },
  });
  app.io.to(`user:${userId}`).emit("notification", n);
  void sendPush(userId, title, path).catch(() =>
    app.log.warn("Push delivery failed."),
  );
}
export function messagingRoutes(app: FastifyInstance) {
  app.get("/api/rooms", async (r) => {
    const u = await auth(r);
    const p = page(r);
    const rooms = await db.room.findMany({
      where: { members: { some: { userId: u.id } } },
      include: {
        members: { include: { user: { select: publicUser } } },
        messages: {
          where: { deletedAt: null },
          orderBy: { createdAt: "desc" },
          take: 1,
        },
      },
      orderBy: { updatedAt: "desc" },
      skip: p.skip,
      take: p.take,
    });
    return Promise.all(
      rooms.map(async (room) => ({
        ...room,
        unread: await db.message.count({
          where: {
            roomId: room.id,
            senderId: { not: u.id },
            deletedAt: null,
            createdAt: {
              gt: room.members.find((m) => m.userId === u.id)!.readAt,
            },
          },
        }),
      })),
    );
  });
  app.post("/api/rooms/private", async (r) => {
    const u = await auth(r);
    const { userId } = z.object({ userId: z.string() }).parse(r.body);
    const other = await db.user.findUnique({ where: { id: userId } });
    if (
      userId === u.id ||
      !other ||
      other.status !== "ACTIVE" ||
      !other.discoverable ||
      (await blocked(u.id, userId))
    )
      fail(403, "Utilisateur indisponible.");
    const directKey = [u.id, userId].sort().join(":");
    return db.room.upsert({
      where: { directKey },
      update: {},
      create: {
        kind: "PRIVATE",
        directKey,
        members: { create: [{ userId: u.id }, { userId }] },
      },
    });
  });
  app.post("/api/groups", async (r) => {
    const u = await auth(r);
    const b = z
      .object({
        name: z.string().trim().min(2).max(80),
        description: z.string().max(1000).default(""),
      })
      .parse(r.body);
    return db.room.create({
      data: {
        ...b,
        kind: "GROUP",
        members: { create: { userId: u.id, role: "OWNER" } },
      },
    });
  });
  app.patch("/api/groups/:id", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    await member(u.id, id, true);
    const b = z
      .object({
        name: z.string().min(2).max(80).optional(),
        description: z.string().max(1000).optional(),
        avatarId: z.string().nullable().optional(),
      })
      .parse(r.body);
    if (
      b.avatarId &&
      !(await db.media.findFirst({
        where: { id: b.avatarId, ownerId: u.id, purpose: "image" },
      }))
    )
      fail(400, "Image invalide.");
    return db.room.update({ where: { id }, data: b });
  });
  app.post("/api/groups/:id/members", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    await member(u.id, id, true);
    const { userId } = z.object({ userId: z.string() }).parse(r.body);
    const target = await db.user.findUnique({ where: { id: userId } });
    if (
      !target ||
      !target.discoverable ||
      target.status !== "ACTIVE" ||
      (await blocked(u.id, userId))
    )
      fail(403, "Utilisateur indisponible.");
    const m = await db.member.upsert({
      where: { roomId_userId: { roomId: id, userId } },
      create: { roomId: id, userId },
      update: {},
    });
    await notify(
      app,
      userId,
      "groups",
      "Vous avez rejoint un groupe",
      `/discussions/${id}`,
    );
    return m;
  });
  app.patch("/api/groups/:id/members/:userId", async (r) => {
    const u = await auth(r);
    const { id, userId } = z
      .object({ id: z.string(), userId: z.string() })
      .parse(r.params);
    const m = await member(u.id, id, true);
    if (m.role !== "OWNER" || userId === u.id)
      fail(403, "Seul le créateur peut changer ce rôle.");
    const b = z.object({ role: z.enum(["ADMIN", "MEMBER"]) }).parse(r.body);
    return db.member.update({
      where: { roomId_userId: { roomId: id, userId } },
      data: b,
    });
  });
  app.delete("/api/groups/:id/members/:userId", async (r) => {
    const u = await auth(r);
    const { id, userId } = z
      .object({ id: z.string(), userId: z.string() })
      .parse(r.params);
    const m = await member(u.id, id, userId !== u.id);
    const target = await db.member.findUnique({
      where: { roomId_userId: { roomId: id, userId } },
    });
    if (
      target?.role === "OWNER" ||
      (target?.role === "ADMIN" && m.role !== "OWNER" && u.id !== userId)
    )
      fail(403, "Ce membre ne peut pas être retiré.");
    await db.member.deleteMany({ where: { roomId: id, userId } });
    return { ok: true };
  });
  app.get("/api/rooms/:id", async (r) => {
    const u = await auth(r);
    await member(u.id, idParam(r));
    return db.room.findUnique({
      where: { id: idParam(r) },
      include: { members: { include: { user: { select: publicUser } } } },
    });
  });
  app.get("/api/rooms/:id/messages", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    await member(u.id, id);
    const p = page(r);
    return db.message.findMany({
      where: { roomId: id, deletedAt: null },
      include: {
        sender: { select: publicUser },
        media: { select: { id: true, name: true, mime: true, durationSeconds: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: p.skip,
      take: p.take,
    });
  });
  app.post("/api/rooms/:id/messages", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    const m = await member(u.id, id);
    if (m.room.locked) fail(403, "Discussion verrouillée.");
    const b = z
      .object({
        body: z.string().max(10000).default(""),
        clientId: z.string().uuid(),
        mediaId: z.string().optional(),
      })
      .refine((b) => b.body.trim() || b.mediaId)
      .parse(r.body);
    if (
      b.mediaId &&
      !(await db.media.findFirst({
        where: { id: b.mediaId, ownerId: u.id, message: null },
      }))
    )
      fail(403, "Pièce jointe indisponible.");
    const existing = await db.message.findUnique({
      where: { senderId_clientId: { senderId: u.id, clientId: b.clientId } },
    });
    if (existing) {
      if (existing.roomId !== id) fail(409, "Identifiant déjà utilisé.");
      return existing;
    }
    const msg = await db.$transaction(async (tx) => {
      const msg = await tx.message.create({
        data: { ...b, roomId: id, senderId: u.id },
        include: {
          sender: { select: publicUser },
          media: { select: { id: true, name: true, mime: true, durationSeconds: true } },
        },
      });
      await tx.room.update({ where: { id }, data: { updatedAt: new Date() } });
      return msg;
    });
    for (const target of m.room.members) {
      if (target.userId !== u.id && (await blocked(u.id, target.userId)))
        continue;
      app.io.to(`user:${target.userId}`).emit("message", msg);
      if (target.userId !== u.id)
        await notify(
          app,
          target.userId,
          m.room.kind === "GROUP" ? "groups" : "messages",
          "Nouveau message",
          `/discussions/${id}`,
        );
    }
    return msg;
  });
  for (const status of ["read", "delivered"] as const)
    app.post(`/api/rooms/:id/${status}`, async (r) => {
      const u = await auth(r);
      const id = idParam(r);
      const m = await member(u.id, id);
      const now = new Date();
      await db.member.update({
        where: { roomId_userId: { roomId: id, userId: u.id } },
        data:
          status === "read"
            ? { readAt: now, deliveredAt: now }
            : { deliveredAt: now },
      });
      for (const t of m.room.members)
        app.io
          .to(`user:${t.userId}`)
          .emit("receipt", { roomId: id, userId: u.id, status, at: now });
      return { ok: true };
    });
}
