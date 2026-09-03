import type { FastifyInstance } from "fastify";
import { fileTypeFromBuffer } from "file-type";
import { randomUUID } from "node:crypto";
import { db, auth, fail, idParam, member } from "./core.js";
import { Storage } from "./providers.js";
export function mediaRoutes(app: FastifyInstance) {
  const storage = new Storage();
  app.post(
    "/api/media",
    { config: { rateLimit: { max: 20, timeWindow: "1 hour" } } },
    async (r) => {
      const u = await auth(r);
      const part = await r.file();
      if (!part) fail(400, "Fichier requis.");
      const data = await part!.toBuffer();
      const durationHeader = r.headers["x-media-duration"];
      const durationSeconds = durationHeader === undefined ? undefined : Number(durationHeader);
      if (durationSeconds !== undefined && (!Number.isInteger(durationSeconds) || durationSeconds < 0 || durationSeconds > 3600)) fail(400, "Durée du média invalide.");
      const type = await fileTypeFromBuffer(data);
      if (
        !type ||
        ![
          "image/jpeg",
          "image/png",
          "image/webp",
          "application/pdf",
          "audio/ogg",
          "audio/mpeg",
          "audio/wav",
          "video/webm",
          "audio/webm",
          "video/mp4",
        ].includes(type.mime)
      )
        fail(415, "Type de fichier non autorisé.");
      if (data.length > 10 * 1024 * 1024) fail(413, "Fichier trop volumineux.");
      const key = randomUUID();
      await storage.put(key, data, type!.mime);
      try {
        return await db.media.create({
          data: {
            ownerId: u.id,
            key,
            name:
              part!.filename
                .replace(/[^\p{L}\p{N} ._-]/gu, "_")
                .slice(0, 150) || "fichier",
            mime: type!.mime,
            size: data.length,
            purpose: type!.mime.startsWith("image/") ? "image" : "attachment",
            durationSeconds,
          },
        });
      } catch (e) {
        await storage.remove(key);
        throw e;
      }
    },
  );
  app.get("/api/media/:id", async (r, reply) => {
    const id = idParam(r);
    const f = await db.media.findUnique({
      where: { id },
      include: { message: true },
    });
    if (!f) fail(404, "Fichier introuvable.");
    const article = await db.article.findFirst({
      where: { imageId: id, publishedAt: { not: null } },
    });
    if (!article) {
      const u = await auth(r);
      if (f!.ownerId !== u.id) {
        if (f!.message) await member(u.id, f!.message.roomId);
        else {
          const avatar = await db.user.findFirst({
            where: {
              avatarId: id,
              discoverable: true,
              status: "ACTIVE",
              blocks: { none: { targetId: u.id } },
              blockedBy: { none: { userId: u.id } },
            },
          });
          const group = await db.room.findFirst({
            where: { avatarId: id, members: { some: { userId: u.id } } },
          });
          if (!avatar && !group) fail(404, "Fichier introuvable.");
        }
      }
    }
    reply
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header(
        "Content-Disposition",
        `${f!.mime.startsWith("image/") || f!.mime.startsWith("audio/") || f!.mime.startsWith("video/") ? "inline" : "attachment"}; filename="${encodeURIComponent(f!.name)}"`,
      )
      .type(f!.mime);
    return storage.get(f!.key);
  });
}
