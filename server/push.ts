import webpush from "web-push";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { auth, db, fail } from "./core.js";
export function pushConfigured() {
  return !!(
    process.env.VAPID_PUBLIC_KEY &&
    process.env.VAPID_PRIVATE_KEY &&
    process.env.VAPID_SUBJECT
  );
}
export async function sendPush(userId: string, title: string, path: string) {
  if (!pushConfigured()) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!,
  );
  const list = await db.pushSubscription.findMany({
    where: { userId },
    take: 10,
  });
  for (const s of list) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, path }),
        { TTL: 3600, timeout: 10000 },
      );
    } catch (e) {
      if ([404, 410].includes((e as { statusCode: number }).statusCode))
        await db.pushSubscription.deleteMany({ where: { id: s.id } });
      else
        console.error(
          "Push delivery failed; notification remains available in app.",
        );
    }
  }
}
export function pushRoutes(app: FastifyInstance) {
  app.get("/api/push/config", async (r) => {
    await auth(r);
    return {
      configured: pushConfigured(),
      publicKey: process.env.VAPID_PUBLIC_KEY || null,
    };
  });
  app.post("/api/push/subscribe", async (r) => {
    const u = await auth(r);
    if (!pushConfigured()) fail(503, "Notifications push non configurées.");
    const b = z
      .object({
        endpoint: z.url().max(2000),
        keys: z.object({
          p256dh: z.string().min(40).max(200),
          auth: z.string().min(10).max(100),
        }),
      })
      .parse(r.body);
    const url = new URL(b.endpoint);
    if (
      url.protocol !== "https:" ||
      ![
        "fcm.googleapis.com",
        "updates.push.services.mozilla.com",
        "web.push.apple.com",
      ].some((h) => url.hostname === h || url.hostname.endsWith(`.${h}`))
    )
      fail(400, "Service push non autorisé.");
    if ((await db.pushSubscription.count({ where: { userId: u.id } })) >= 10)
      fail(409, "Limite de 10 appareils atteinte.");
    const existing = await db.pushSubscription.findUnique({
      where: { endpoint: b.endpoint },
    });
    if (existing && existing.userId !== u.id)
      fail(409, "Abonnement déjà associé.");
    return db.pushSubscription.upsert({
      where: { endpoint: b.endpoint },
      create: { userId: u.id, endpoint: b.endpoint, ...b.keys },
      update: b.keys,
    });
  });
  app.post("/api/push/unsubscribe", async (r) => {
    const u = await auth(r);
    const { endpoint } = z.object({ endpoint: z.string() }).parse(r.body);
    await db.pushSubscription.deleteMany({ where: { userId: u.id, endpoint } });
    return { ok: true };
  });
}
