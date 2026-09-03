import { eraseAccount } from "./accounts.js";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import bcrypt from "bcryptjs";
import {
  db,
  auth,
  admin,
  audit,
  blocked,
  fail,
  idParam,
  page,
  publicUser,
  self,
  seal,
  hasStoredOpenAiKey,
} from "./core.js";
import type { AIProvider } from "./providers.js";
export function domainRoutes(app: FastifyInstance, ai: AIProvider) {
  app.delete("/api/admin/users/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    const target = await db.user.findUnique({ where: { id } });
    if (!target || target.role === "ADMIN")
      fail(403, "Suppression interdite pour cet administrateur.");
    await eraseAccount(id, a.id);
    app.io.in(`user:${id}`).disconnectSockets();
    return { ok: true };
  });
  app.patch("/api/me", async (r) => {
    const u = await auth(r);
    const b = z
      .object({
        name: z.string().min(2).max(80).optional(),
        bio: z.string().max(1000).optional(),
        avatarId: z.string().nullable().optional(),
        discoverable: z.boolean().optional(),
        showPresence: z.boolean().optional(),
        language: z.enum(["fr", "en"]).optional(),
        theme: z.enum(["dark", "light"]).optional(),
        preferences: z
          .partialRecord(
            z.enum([
              "messages",
              "groups",
              "calls",
              "news",
              "security",
              "system",
            ]),
            z.boolean(),
          )
          .optional(),
      })
      .parse(r.body);
    if (
      b.avatarId &&
      !(await db.media.findFirst({
        where: { id: b.avatarId, ownerId: u.id, purpose: "image" },
      }))
    )
      fail(400, "Image invalide.");
    return self(await db.user.update({ where: { id: u.id }, data: b }));
  });
  app.delete("/api/me", async (r) => {
    const u = await auth(r);
    const b = z.object({ password: z.string().max(72) }).parse(r.body);
    if (!(await bcrypt.compare(b.password, u.passwordHash)))
      fail(403, "Mot de passe incorrect.");
    await eraseAccount(u.id);
    app.io.in(`user:${u.id}`).disconnectSockets();
    return { ok: true };
  });
  app.get("/api/users", async (r) => {
    const u = await auth(r);
    const p = page(r);
    return db.user.findMany({
      where: {
        status: "ACTIVE",
        discoverable: true,
        id: { not: u.id },
        blocks: { none: { targetId: u.id } },
        blockedBy: { none: { userId: u.id } },
        OR: [
          { name: { contains: p.q, mode: "insensitive" } },
          { username: { contains: p.q, mode: "insensitive" } },
        ],
      },
      select: publicUser,
      skip: p.skip,
      take: p.take,
    });
  });
  app.get("/api/users/:id", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    if (await blocked(u.id, id)) fail(404, "Profil introuvable.");
    const v = await db.user.findFirst({
      where: {
        id,
        status: "ACTIVE",
        OR: [{ discoverable: true }, { id: u.id }],
      },
      select: {
        ...publicUser,
        _count: {
          select: { articles: { where: { publishedAt: { not: null } } } },
        },
      },
    });
    return v || fail(404, "Profil introuvable.");
  });
  app.get("/api/contacts", async (r) => {
    const u = await auth(r);
    return db.contact.findMany({
      where: {
        userId: u.id,
        target: {
          status: "ACTIVE",
          blocks: { none: { targetId: u.id } },
          blockedBy: { none: { userId: u.id } },
        },
      },
      include: { target: { select: publicUser } },
      take: 30,
      skip: page(r).skip,
    });
  });
  app.post("/api/contacts/:id", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    if (
      u.id === id ||
      (await blocked(u.id, id)) ||
      !(await db.user.findFirst({
        where: { id, discoverable: true, status: "ACTIVE" },
      }))
    )
      fail(403, "Contact indisponible.");
    return db.contact.upsert({
      where: { userId_targetId: { userId: u.id, targetId: id } },
      create: { userId: u.id, targetId: id },
      update: {},
    });
  });
  app.delete("/api/contacts/:id", async (r) => {
    const u = await auth(r);
    await db.contact.deleteMany({
      where: { userId: u.id, targetId: idParam(r) },
    });
    return { ok: true };
  });
  app.get("/api/blocks", async (r) => {
    const u = await auth(r);
    return db.block.findMany({
      where: { userId: u.id },
      include: { target: { select: publicUser } },
      take: 30,
      skip: page(r).skip,
    });
  });
  app.post("/api/blocks/:id", async (r) => {
    const u = await auth(r);
    const id = idParam(r);
    if (u.id === id) fail(400, "Action invalide.");
    await db.block.upsert({
      where: { userId_targetId: { userId: u.id, targetId: id } },
      create: { userId: u.id, targetId: id },
      update: {},
    });
    return { ok: true };
  });
  app.delete("/api/blocks/:id", async (r) => {
    const u = await auth(r);
    await db.block.deleteMany({
      where: { userId: u.id, targetId: idParam(r) },
    });
    return { ok: true };
  });
  app.get("/api/ai/threads", async (r) => {
    const u = await auth(r);
    return db.aiThread.findMany({
      where: { userId: u.id },
      orderBy: { updatedAt: "desc" },
      skip: page(r).skip,
      take: 30,
    });
  });
  app.post("/api/ai/threads", async (r) =>
    db.aiThread.create({ data: { userId: (await auth(r)).id } }),
  );
  app.get("/api/ai/threads/:id", async (r) => {
    const u = await auth(r);
    const t = await db.aiThread.findFirst({
      where: { id: idParam(r), userId: u.id },
      include: {
        messages: {
          orderBy: { createdAt: "desc" },
          take: 30,
          skip: page(r).skip,
        },
      },
    });
    return t || fail(404, "Conversation introuvable.");
  });
  app.delete("/api/ai/threads/:id", async (r) => {
    const u = await auth(r);
    const d = await db.aiThread.deleteMany({
      where: { id: idParam(r), userId: u.id },
    });
    if (!d.count) fail(404, "Conversation introuvable.");
    return { ok: true };
  });
  app.post(
    "/api/ai/threads/:id/messages",
    { config: { rateLimit: { max: 20, timeWindow: "1 minute" } } },
    async (r) => {
      const u = await auth(r);
      const id = idParam(r);
      const b = z
        .object({ content: z.string().trim().min(1).max(12000) })
        .parse(r.body);
      const t = await db.aiThread.findFirst({
        where: { id, userId: u.id },
        include: { messages: { orderBy: { createdAt: "desc" }, take: 20 } },
      });
      if (!t) fail(404, "Conversation introuvable.");
      const content = await ai.complete([
        {
          role: "system",
          content:
            "Tu es Planète LIBIA AI, un assistant utile. Réponds en français sauf demande contraire.",
        },
        ...t!.messages
          .reverse()
          .map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: b.content },
      ]);
      return db.aiThread.update({
        where: { id },
        data: {
          title: t!.messages.length ? t!.title : b.content.slice(0, 80),
          updatedAt: new Date(),
          messages: {
            create: [
              { role: "user", content: b.content, createdAt: new Date() },
              {
                role: "assistant",
                content,
                createdAt: new Date(Date.now() + 1),
              },
            ],
          },
        },
        include: { messages: { orderBy: { createdAt: "asc" }, take: 100 } },
      });
    },
  );
  app.get("/api/categories", async () =>
    db.category.findMany({ orderBy: { name: "asc" } }),
  );
  app.get("/api/news", async (r) => {
    const p = page(r);
    const { category } = z
      .object({ category: z.string().optional() })
      .parse(r.query);
    return db.article.findMany({
      where: {
        publishedAt: { not: null },
        categoryId: category || undefined,
        OR: [
          { title: { contains: p.q, mode: "insensitive" } },
          { summary: { contains: p.q, mode: "insensitive" } },
        ],
      },
      include: { category: true, author: { select: publicUser } },
      orderBy: { publishedAt: "desc" },
      skip: p.skip,
      take: 30,
    });
  });
  app.get("/api/news/:id", async (r) => {
    return (
      (await db.article.findFirst({
        where: { id: idParam(r), publishedAt: { not: null } },
        include: { category: true, author: { select: publicUser } },
      })) || fail(404, "Article introuvable.")
    );
  });
  app.get("/api/notifications", async (r) => {
    const u = await auth(r);
    return {
      items: await db.notification.findMany({
        where: { userId: u.id },
        orderBy: { createdAt: "desc" },
        skip: page(r).skip,
        take: 30,
      }),
      unread: await db.notification.count({
        where: { userId: u.id, readAt: null },
      }),
    };
  });
  app.post("/api/notifications/:id/read", async (r) => {
    const u = await auth(r);
    const result = await db.notification.updateMany({
      where: { id: idParam(r), userId: u.id },
      data: { readAt: new Date() },
    });
    if (!result.count) fail(404, "Notification introuvable.");
    return { ok: true };
  });
  app.post("/api/reports", async (r) => {
    const u = await auth(r);
    const b = z
      .object({
        targetType: z.enum(["USER", "MESSAGE", "GROUP", "SUPPORT"]),
        targetId: z.string().max(100),
        reason: z.string().trim().min(10).max(2000),
      })
      .parse(r.body);
    return db.report.create({ data: { ...b, reporterId: u.id } });
  });
  app.get("/api/public/settings", async () => ({
    contact: process.env.PUBLIC_CONTACT_EMAIL || null,
    social: process.env.PUBLIC_SOCIAL_URL || null,
    version: "1.0.0",
  }));
  app.get("/api/admin/stats", async (r) => {
    await admin(r);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const week = new Date(Date.now() - 7 * 86400000);
    const [users, newToday, newWeek, verified, unverified, suspended, sessions, privateRooms, groups, messages, messagesToday, aiThreads, aiMessages, articles, published, reports, notifications, audioCalls, videoCalls, media] = await Promise.all([
      db.user.count(), db.user.count({ where: { createdAt: { gte: today } } }),
      db.user.count({ where: { createdAt: { gte: week } } }), db.user.count({ where: { verifiedAt: { not: null } } }),
      db.user.count({ where: { verifiedAt: null } }), db.user.count({ where: { status: "SUSPENDED" } }),
      db.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
      db.room.count({ where: { kind: "PRIVATE" } }), db.room.count({ where: { kind: "GROUP" } }),
      db.message.count(), db.message.count({ where: { createdAt: { gte: today } } }),
      db.aiThread.count(), db.aiMessage.count(), db.article.count(),
      db.article.count({ where: { publishedAt: { not: null } } }), db.report.count({ where: { state: "OPEN" } }),
      db.notification.count(), db.call.count({ where: { video: false } }), db.call.count({ where: { video: true } }), db.media.count(),
    ]);
    return {
      users, newToday, newWeek, verified, unverified, suspended, sessions,
      privateRooms, groups, messages, messagesToday, aiThreads, aiMessages,
      articles, published, drafts: articles - published, reports, notifications,
      audioCalls, videoCalls, media,
    };
  });
  app.get("/api/admin/system", async (r) => {
    await admin(r);
    let database = "Unavailable";
    try { await db.user.count(); database = "Operational"; } catch { /* safe status only */ }
    return {
      api: "Operational",
      database,
      ai: {
        status: (process.env.AI_API_KEY || await hasStoredOpenAiKey()) && process.env.AI_MODEL && process.env.AI_BASE_URL ? "Configured" : "Unconfigured",
        provider: process.env.AI_PROVIDER || null,
        model: process.env.AI_MODEL || null,
      },
      google: { status: process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET ? "Configured" : "Unconfigured" },
      verification: { status: process.env.VERIFICATION_PROVIDER ? "Configured" : "Unconfigured", provider: process.env.VERIFICATION_PROVIDER || null },
      storage: { status: process.env.STORAGE_PROVIDER === "s3" ? (process.env.S3_BUCKET ? "Configured" : "Unconfigured") : "Operational", provider: process.env.STORAGE_PROVIDER || "local" },
      redis: { status: process.env.REDIS_URL ? "Configured" : "Unconfigured" },
    };
  });
  app.get("/api/admin/ai-config", async (r) => {
    await admin(r);
    return {
      configured: !!process.env.AI_API_KEY || (await hasStoredOpenAiKey()),
      source: process.env.AI_API_KEY ? "environment" : (await hasStoredOpenAiKey()) ? "admin" : null,
      provider: process.env.AI_PROVIDER || "openai-compatible",
      model: process.env.AI_MODEL || "gpt-5.6-luna",
    };
  });
  app.put("/api/admin/ai-config", async (r) => {
    const a = await admin(r);
    const b = z.object({ apiKey: z.string().trim().min(20).max(500) }).parse(r.body);
    await db.setting.upsert({
      where: { key: "_secret.openai" },
      create: { key: "_secret.openai", value: { encrypted: seal(b.apiKey) } },
      update: { value: { encrypted: seal(b.apiKey) } },
    });
    await audit(a.id, "ai.credential.update", "openai");
    return { ok: true };
  });
  app.delete("/api/admin/ai-config", async (r) => {
    const a = await admin(r);
    if (process.env.AI_API_KEY) fail(409, "La clé définie dans l’environnement doit être retirée sur le serveur.");
    await db.setting.deleteMany({ where: { key: "_secret.openai" } });
    await audit(a.id, "ai.credential.remove", "openai");
    return { ok: true };
  });
  app.get("/api/admin/users", async (r) => {
    await admin(r);
    const p = page(r);
    return db.user.findMany({
      where: {
        OR: [
          { name: { contains: p.q, mode: "insensitive" } },
          { email: { contains: p.q, mode: "insensitive" } },
        ],
      },
      select: {
        ...publicUser,
        email: true,
        status: true,
        role: true,
        createdAt: true,
      },
      take: 30,
      skip: p.skip,
    });
  });
  app.patch("/api/admin/users/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    const b = z
      .object({ status: z.enum(["ACTIVE", "SUSPENDED"]) })
      .parse(r.body);
    const target = await db.user.findUnique({ where: { id } });
    if (!target || target.role === "ADMIN")
      fail(403, "Action interdite sur cet administrateur.");
    await db.$transaction([
      db.user.update({ where: { id }, data: b }),
      db.session.updateMany({
        where: { userId: id },
        data: { revokedAt: new Date() },
      }),
      db.auditLog.create({
        data: { actorId: a.id, action: `user.${b.status}`, target: id },
      }),
    ]);
    app.io.in(`user:${id}`).disconnectSockets();
    return { ok: true };
  });
  app.get("/api/admin/groups", async (r) => {
    await admin(r);
    return db.room.findMany({
      where: { kind: "GROUP" },
      include: { _count: { select: { members: true, messages: true } } },
      take: 30,
      skip: page(r).skip,
    });
  });
  app.patch("/api/admin/groups/:id", async (r) => {
    const a = await admin(r);
    const b = z.object({ locked: z.boolean() }).parse(r.body);
    const id = idParam(r);
    await db.room.update({ where: { id, kind: "GROUP" }, data: b });
    await audit(a.id, "group.moderate", id);
    return { ok: true };
  });
  app.delete("/api/admin/messages/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    await db.message.update({
      where: { id },
      data: { body: "", deletedAt: new Date() },
    });
    await audit(a.id, "message.remove", id);
    return { ok: true };
  });
  app.get("/api/admin/news", async (r) => {
    await admin(r);
    return db.article.findMany({
      include: { category: true },
      take: 30,
      skip: page(r).skip,
      orderBy: { createdAt: "desc" },
    });
  });
  const article = z.object({
    title: z.string().min(3).max(200),
    summary: z.string().min(5).max(500),
    content: z.string().min(10).max(100000),
    categoryId: z.string(),
    imageId: z.string().nullable().optional(),
    published: z.boolean(),
  });
  async function articleData(data: unknown, userId: string) {
    const { published, ...b } = article.parse(data);
    if (
      b.imageId &&
      !(await db.media.findFirst({
        where: { id: b.imageId, ownerId: userId, purpose: "image" },
      }))
    )
      fail(400, "Image invalide.");
    return { ...b, publishedAt: published ? new Date() : null };
  }
  app.post("/api/admin/news", async (r) => {
    const a = await admin(r);
    const n = await db.article.create({
      data: { ...(await articleData(r.body, a.id)), authorId: a.id },
    });
    await audit(a.id, "article.create", n.id);
    return n;
  });
  app.patch("/api/admin/news/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    const n = await db.article.update({
      where: { id },
      data: await articleData(r.body, a.id),
    });
    await audit(a.id, "article.update", id);
    return n;
  });
  app.delete("/api/admin/news/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    await db.article.delete({ where: { id } });
    await audit(a.id, "article.delete", id);
    return { ok: true };
  });
  app.post("/api/admin/categories", async (r) => {
    const a = await admin(r);
    const b = z.object({ name: z.string().min(2).max(80) }).parse(r.body);
    const c = await db.category.create({ data: b });
    await audit(a.id, "category.create", c.id);
    return c;
  });
  app.delete("/api/admin/categories/:id", async (r) => {
    const a = await admin(r);
    const id = idParam(r);
    await db.category.delete({ where: { id } });
    await audit(a.id, "category.delete", id);
    return { ok: true };
  });
  app.get("/api/admin/reports", async (r) => {
    await admin(r);
    return db.report.findMany({
      take: 30,
      skip: page(r).skip,
      orderBy: { createdAt: "desc" },
    });
  });
  app.patch("/api/admin/reports/:id", async (r) => {
    const a = await admin(r);
    const b = z
      .object({
        state: z.enum(["OPEN", "RESOLVED"]),
        resolution: z.string().max(2000),
      })
      .parse(r.body);
    await db.report.update({ where: { id: idParam(r) }, data: b });
    await audit(a.id, "report.update", idParam(r));
    return { ok: true };
  });
  app.get("/api/admin/audit", async (r) => {
    await admin(r);
    return db.auditLog.findMany({
      take: 30,
      skip: page(r).skip,
      orderBy: { createdAt: "desc" },
      include: { actor: { select: publicUser } },
    });
  });
  app.get("/api/admin/settings", async (r) => {
    await admin(r);
    return db.setting.findMany({ where: { key: { not: { startsWith: "_secret." } } } });
  });
  app.put("/api/admin/settings", async (r) => {
    const a = await admin(r);
    const b = z
      .object({
        key: z.enum(["announcement", "supportText", "legalText"]),
        value: z.string().max(5000),
      })
      .parse(r.body);
    await db.setting.upsert({
      where: { key: b.key },
      create: b,
      update: { value: b.value },
    });
    await audit(a.id, "setting.update", b.key);
    return { ok: true };
  });
  app.get("/api/content", async () =>
    db.setting.findMany({
      where: { key: { in: ["announcement", "supportText", "legalText"] } },
    }),
  );
}
