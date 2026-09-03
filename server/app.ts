import Fastify from "fastify";
import cookie from "@fastify/cookie";
import helmet from "@fastify/helmet";
import multipart from "@fastify/multipart";
import rateLimit from "@fastify/rate-limit";
import statics from "@fastify/static";
import { Redis } from "ioredis";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import path from "node:path";
import { existsSync } from "node:fs";
import { db, fail } from "./core.js";
import {
  ConfiguredAI,
  ConfiguredCodes,
  type AIProvider,
  type CodeProvider,
} from "./providers.js";
import { authRoutes } from "./auth.js";
import { domainRoutes } from "./domains.js";
import { messagingRoutes } from "./messaging.js";
import { realtime } from "./realtime.js";
import { mediaRoutes } from "./media.js";
import { pushRoutes } from "./push.js";
import { publicPages } from "./seo.js";
import { googleRoutes, type GoogleProvider } from "./google.js";
export async function buildApp(
  options: {
    ai?: AIProvider;
    codes?: CodeProvider;
    google?: GoogleProvider;
    logger?: boolean;
  } = {},
) {
  if (
    process.env.NODE_ENV === "production" &&
    (!process.env.APP_ORIGIN?.startsWith("https://") || !process.env.REDIS_URL)
  )
    throw new Error(
      "HTTPS APP_ORIGIN and REDIS_URL are required in production.",
    );
  const app = Fastify({
    logger: options.logger ?? false,
    bodyLimit: 1024 * 1024,
    trustProxy: process.env.TRUST_PROXY === "true",
  });
  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:", "blob:"],
        connectSrc: ["'self'"],
        mediaSrc: ["'self'", "blob:"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
        upgradeInsecureRequests:
          process.env.NODE_ENV === "production" ? [] : null,
      },
    },
  });
  const redis = process.env.REDIS_URL
    ? new Redis(process.env.REDIS_URL)
    : undefined;
  await app.register(rateLimit, { max: 200, timeWindow: "1 minute", redis });
  if (redis) app.addHook("onClose", async () => redis.disconnect());
  await app.register(multipart, {
    limits: { fileSize: 10 * 1024 * 1024, files: 1, fields: 2 },
  });
  app.addHook("onRequest", async (r, reply) => {
    if (r.url.startsWith("/api/")) {
      reply.header("Cache-Control", "no-store");
      if (!["GET", "HEAD", "OPTIONS"].includes(r.method)) {
        if (
          r.headers.origin !==
            (process.env.APP_ORIGIN || "http://localhost:5173") ||
          r.headers["x-pl-request"] !== "1"
        )
          fail(403, "Origine de la requête refusée.");
      }
    }
  });
  app.setErrorHandler((e, r, reply) => {
    if (e instanceof ZodError)
      return reply.code(400).send({
        error: "Corrigez les champs indiqués ci-dessous.",
        details: e.issues.map((v) => ({
          field: v.path.join("."),
          message: v.message,
        })),
      });
    if (e instanceof Prisma.PrismaClientKnownRequestError) {
      if (e.code === "P2002") {
        const messages: Record<string, string> = {
          email:
            "Cette adresse e-mail est déjà utilisée. Connectez-vous ou choisissez une autre adresse.",
          phone: "Ce numéro de téléphone est déjà utilisé.",
          username:
            "Ce nom d’utilisateur est déjà pris. Choisissez-en un autre.",
        };
        const fields = Array.isArray(e.meta?.target)
          ? (e.meta.target as string[])
          : [];
        return reply.code(409).send({
          error: "Un compte utilise déjà ces informations.",
          details: fields
            .filter((f) => messages[f])
            .map((field) => ({ field, message: messages[field] })),
        });
      }
      if (["P2025", "P2003"].includes(e.code))
        return reply
          .code(404)
          .send({ error: "Ressource introuvable ou encore utilisée." });
    }
    const status = (e as { statusCode?: number }).statusCode || 500;
    if (status >= 500) r.log.error(e);
    return reply.code(status).send({
      error:
        status === 500
          ? "Erreur interne. Veuillez réessayer."
          : (e as Error).message,
    });
  });
  realtime(app);
  authRoutes(app, options.codes || new ConfiguredCodes());
  googleRoutes(app, options.google);
  messagingRoutes(app);
  domainRoutes(app, options.ai || new ConfiguredAI());
  mediaRoutes(app);
  pushRoutes(app);
  app.get("/api/health", async () => {
    await db.$queryRaw`SELECT 1`;
    if (redis) await redis.ping();
    return { ok: true };
  });
  app.get("/robots.txt", async (_r, reply) =>
    reply
      .type("text/plain")
      .send(
        `User-agent: *\nDisallow: /admin\nDisallow: /api\nDisallow: /discussions\nDisallow: /profil\nSitemap: ${process.env.APP_ORIGIN || "http://localhost:3000"}/sitemap.xml`,
      ),
  );
  app.get("/sitemap.xml", async (_r, reply) => {
    const origin = (process.env.APP_ORIGIN || "http://localhost:3000").replace(
      /[<>&"']/g,
      "",
    );
    const news = await db.article.findMany({
      where: { publishedAt: { not: null } },
      select: { id: true },
      take: 10000,
    });
    return reply
      .type("application/xml")
      .send(
        `<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${["/", "/a-propos", "/actualites", ...news.map((n) => `/actualites/${n.id}`)].map((p) => `<url><loc>${origin}${p}</loc></url>`).join("")}</urlset>`,
      );
  });
  const root = path.resolve("dist/web");
  if (existsSync(root)) {
    publicPages(app, root);
    await app.register(statics, { root, wildcard: false });
    app.setNotFoundHandler((r, reply) =>
      r.url.startsWith("/api/")
        ? reply.code(404).send({ error: "Route introuvable." })
        : reply.sendFile("index.html"),
    );
  }
  return app;
}
