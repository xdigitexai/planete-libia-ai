import type { FastifyInstance } from "fastify";
import { Server } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { Redis } from "ioredis";
import { z } from "zod";
import { createHmac } from "node:crypto";
import {
  db,
  session,
  member,
  auth,
  blocked,
  fail,
  idParam,
  page,
  publicUser,
} from "./core.js";
import { notify } from "./messaging.js";
declare module "fastify" {
  interface FastifyInstance {
    io: Server;
  }
}
export function realtime(app: FastifyInstance) {
  const origin = process.env.APP_ORIGIN || "http://localhost:5173";
  const io = new Server(app.server, {
    maxHttpBufferSize: 65536,
    cors: { origin, credentials: true },
    allowRequest: (req, done) => done(null, req.headers.origin === origin),
  });
  app.decorate("io", io);
  let pub: Redis | undefined, sub: Redis | undefined;
  if (process.env.REDIS_URL) {
    pub = new Redis(process.env.REDIS_URL);
    sub = pub.duplicate();
    io.adapter(createAdapter(pub, sub));
  }
  async function announce(userId: string, online: boolean) {
    const u = await db.user.findUnique({ where: { id: userId } });
    if (!u?.showPresence) return;
    const shared = await db.member.findMany({
      where: { room: { members: { some: { userId } } } },
      select: { userId: true },
      distinct: ["userId"],
    });
    for (const peer of shared)
      if (peer.userId !== userId && !(await blocked(userId, peer.userId)))
        io.to(`user:${peer.userId}`).emit("presence", { userId, online });
  }
  io.use(async (socket, next) => {
    try {
      const raw = app.parseCookie(
        socket.handshake.headers.cookie || "",
      ).pl_session;
      const s = await session(raw);
      socket.data = { raw, userId: s.userId, sessionId: s.id };
      next();
    } catch {
      next(new Error("Connexion requise."));
    }
  });
  io.on("connection", (socket) => {
    void announce(socket.data.userId, true).catch(() => {});
    void socket.join([
      `user:${socket.data.userId}`,
      `session:${socket.data.sessionId}`,
    ]);
    let count = 0,
      window = Date.now();
    socket.use(async (_packet, next) => {
      try {
        if (Date.now() - window > 60000) {
          count = 0;
          window = Date.now();
        }
        if (++count > 120) throw new Error();
        await session(socket.data.raw);
        next();
      } catch {
        next(new Error("Accès refusé."));
        socket.disconnect();
      }
    });
    socket.on("typing", async (payload, ack = () => {}) => {
      try {
        const { roomId, typing } = z
          .object({ roomId: z.string(), typing: z.boolean() })
          .parse(payload);
        const m = await member(socket.data.userId, roomId);
        for (const t of m.room.members)
          if (
            t.userId !== socket.data.userId &&
            !(await blocked(socket.data.userId, t.userId))
          )
            io.to(`user:${t.userId}`).emit("typing", {
              roomId,
              userId: socket.data.userId,
              typing,
            });
        ack({ ok: true });
      } catch {
        ack({ error: "Accès refusé." });
      }
    });
    socket.on("signal", async (payload, ack = () => {}) => {
      try {
        const b = z
          .object({
            callId: z.string(),
            type: z.enum(["offer", "answer", "ice"]),
            data: z.unknown(),
          })
          .parse(payload);
        const c = await db.call.findUnique({ where: { id: b.callId } });
        if (
          !c ||
          !["ACCEPTED", "CONNECTED"].includes(c.state) ||
          ![c.callerId, c.calleeId].includes(socket.data.userId)
        )
          fail(403, "Appel indisponible.");
        await member(socket.data.userId, c!.roomId);
        if (
          (b.type === "offer" && socket.data.userId !== c!.callerId) ||
          (b.type === "answer" && socket.data.userId !== c!.calleeId)
        )
          fail(403, "Signal refusé.");
        io.to(
          `user:${socket.data.userId === c!.callerId ? c!.calleeId : c!.callerId}`,
        ).emit("signal", b);
        ack({ ok: true });
      } catch {
        ack({ error: "Signal refusé." });
      }
    });
    socket.on("disconnect", () => {
      void db.user
        .update({
          where: { id: socket.data.userId },
          data: { lastSeenAt: new Date() },
        })
        .catch(() => {});
      const timeout = setTimeout(() => {
        void (async () => {
          if ((await io.in(`user:${socket.data.userId}`).fetchSockets()).length)
            return;
          await announce(socket.data.userId, false);
          const calls = await db.call.findMany({
            where: {
              state: { in: ["ACCEPTED", "CONNECTED"] },
              OR: [
                { callerId: socket.data.userId },
                { calleeId: socket.data.userId },
              ],
            },
          });
          for (const c of calls) {
            await db.call.updateMany({
              where: { id: c.id, state: { in: ["ACCEPTED", "CONNECTED"] } },
              data: { state: "ENDED", endedAt: new Date() },
            });
            for (const id of [c.callerId, c.calleeId])
              io.to(`user:${id}`).emit("call", { ...c, state: "ENDED" });
          }
        })().catch(() => {});
      }, 5000);
      timeout.unref();
    });
  });
  const timer = setInterval(() => {
    void (async () => {
      const missed = await db.call.findMany({
        where: {
          state: "RINGING",
          createdAt: { lt: new Date(Date.now() - 45000) },
        },
        take: 100,
      });
      for (const c of missed) {
        const result = await db.call.updateMany({
          where: { id: c.id, state: "RINGING" },
          data: { state: "MISSED", endedAt: new Date() },
        });
        if (result.count) {
          for (const id of [c.callerId, c.calleeId])
            io.to(`user:${id}`).emit("call", { ...c, state: "MISSED" });
          await notify(app, c.calleeId, "calls", "Appel manqué", `/appels`);
        }
      }
    })().catch((e) => app.log.error(e));
  }, 10000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    io.close();
    pub?.disconnect();
    sub?.disconnect();
  });
  app.get("/api/rooms/:id/presence", async (r) => {
    const u = await auth(r);
    const m = await member(u.id, idParam(r));
    return Promise.all(
      m.room.members.map(async (t) => {
        const v = await db.user.findUnique({ where: { id: t.userId } });
        return {
          userId: t.userId,
          online:
            !!v?.showPresence &&
            !(await blocked(u.id, t.userId)) &&
            (await io.in(`user:${t.userId}`).fetchSockets()).length > 0,
        };
      }),
    );
  });
  app.get("/api/calls/config", async (r) => {
    await auth(r);
    const iceServers: {
      urls: string | string[];
      username?: string;
      credential?: string;
    }[] = [];
    if (process.env.STUN_URL) iceServers.push({ urls: process.env.STUN_URL });
    if (process.env.TURN_URL && process.env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + 3600}`;
      iceServers.push({
        urls: process.env.TURN_URL,
        username,
        credential: createHmac("sha1", process.env.TURN_SECRET)
          .update(username)
          .digest("base64"),
      });
    }
    return { iceServers, configured: iceServers.length > 0 };
  });
  app.get("/api/calls", async (r) => {
    const u = await auth(r);
    const calls = await db.call.findMany({
      include: {
        caller: { select: publicUser },
        callee: { select: publicUser },
      },
      where: { OR: [{ callerId: u.id }, { calleeId: u.id }] },
      orderBy: { createdAt: "desc" },
      take: 30,
      skip: page(r).skip,
    });
    return calls.map((call) => ({
      ...call,
      durationSeconds:
        call.connectedAt && call.endedAt
          ? Math.max(0, Math.floor((call.endedAt.getTime() - call.connectedAt.getTime()) / 1000))
          : null,
    }));
  });
  app.get("/api/rooms/:id/calls", async (r) => {
    const u = await auth(r);
    const roomId = idParam(r);
    await member(u.id, roomId);
    const calls = await db.call.findMany({
      where: { roomId },
      include: { caller: { select: publicUser }, callee: { select: publicUser } },
      orderBy: { createdAt: "desc" },
      take: 50,
    });
    return calls.map((call) => ({ ...call, durationSeconds: call.connectedAt && call.endedAt ? Math.max(0, Math.floor((call.endedAt.getTime() - call.connectedAt.getTime()) / 1000)) : null }));
  });
  app.post("/api/calls", async (r) => {
    const u = await auth(r);
    const b = z
      .object({ roomId: z.string(), video: z.boolean() })
      .parse(r.body);
    const m = await member(u.id, b.roomId);
    if (m.room.kind !== "PRIVATE")
      fail(400, "Les appels sont disponibles dans les discussions privées.");
    const calleeId = m.room.members.find((v) => v.userId !== u.id)!.userId;
    if (!(await io.in(`user:${calleeId}`).fetchSockets()).length)
      fail(409, "Utilisateur hors ligne.");
    const c = await db.$transaction(async (tx) => {
      for (const participant of [u.id, calleeId].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${participant}))`;
      if (
        await tx.call.findFirst({
          where: {
            state: { in: ["RINGING", "ACCEPTED"] },
            OR: [
              { callerId: { in: [u.id, calleeId] } },
              { calleeId: { in: [u.id, calleeId] } },
            ],
          },
        })
      )
        fail(409, "Un appel est déjà en cours.");
      return tx.call.create({
        data: { ...b, callerId: u.id, calleeId },
        include: {
          caller: { select: publicUser },
          callee: { select: publicUser },
        },
      });
    });
    io.to(`user:${calleeId}`).emit("call", c);
    return c;
  });
  app.post("/api/calls/:id/state", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    const { state } = z
      .object({ state: z.enum(["ACCEPTED", "DECLINED", "ENDED", "CANCELLED"]) })
      .parse(r.body);
    const c = await db.call.findUnique({ where: { id } });
    if (!c || ![c.callerId, c.calleeId].includes(u.id))
      fail(404, "Appel introuvable.");
    await member(u.id, c!.roomId);
    if (state === "ACCEPTED" && (u.id !== c!.calleeId || c!.state !== "RINGING")) fail(409, "Transition invalide.");
    if (state === "DECLINED" && (u.id !== c!.calleeId || c!.state !== "RINGING")) fail(409, "Transition invalide.");
    if (state === "CANCELLED" && (u.id !== c!.callerId || c!.state !== "RINGING")) fail(409, "Transition invalide.");
    if (state === "ENDED" && !["ACCEPTED", "CONNECTED"].includes(c!.state)) fail(409, "Transition invalide.");
    if (!["RINGING", "ACCEPTED", "CONNECTED"].includes(c!.state))
      fail(409, "Appel terminé.");
    const changed = await db.call.updateMany({
      where: { id, state: c!.state },
      data: {
        state,
        ...(state === "ACCEPTED"
          ? { acceptedAt: new Date() }
          : { endedAt: new Date() }),
      },
    });
    if (!changed.count) fail(409, "L’état de l’appel a changé.");
    const updated = await db.call.findUniqueOrThrow({
      where: { id },
      include: {
        caller: { select: publicUser },
        callee: { select: publicUser },
      },
    });
    for (const userId of [c!.callerId, c!.calleeId])
      io.to(`user:${userId}`).emit("call", updated);
    return updated;
  });
  app.post("/api/calls/:id/connected", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    const call = await db.call.findUnique({ where: { id } });
    if (!call || ![call.callerId, call.calleeId].includes(u.id)) fail(404, "Appel introuvable.");
    await member(u.id, call!.roomId);
    if (!["ACCEPTED", "CONNECTED"].includes(call!.state)) fail(409, "Transition invalide.");
    const updated = await db.call.update({ where: { id }, data: { state: "CONNECTED", connectedAt: call!.connectedAt || new Date() }, include: { caller: { select: publicUser }, callee: { select: publicUser } } });
    for (const userId of [call!.callerId, call!.calleeId]) io.to(`user:${userId}`).emit("call", updated);
    return updated;
  });
}
