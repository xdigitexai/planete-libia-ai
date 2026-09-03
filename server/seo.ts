import type { FastifyInstance } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./core.js";
const escape = (s: string) =>
  s.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
export function publicPages(app: FastifyInstance, root: string) {
  async function html(
    title: string,
    description: string,
    body: string,
    urlPath: string,
  ) {
    const template = await readFile(path.join(root, "index.html"), "utf8");
    const origin = process.env.APP_ORIGIN || "http://localhost:3000";
    return template
      .replace(
        /<title>.*?<\/title>/s,
        `<title>${escape(title)} — PLANÈTE LIBIA AI</title>`,
      )
      .replace(
        /<meta\s+name="description"\s+content="[^"]*"\s*\/?\s*>/s,
        `<meta name="description" content="${escape(description)}"/>`,
      )
      .replace(
        /<meta\s+property="og:title"\s+content="[^"]*"\s*\/?\s*>/s,
        `<meta property="og:title" content="${escape(title)}"/>`,
      )
      .replace(
        /<meta\s+property="og:description"\s+content="[^"]*"\s*\/?\s*>/s,
        `<meta property="og:description" content="${escape(description)}"/>`,
      )
      .replace(
        "</head>",
        `<link rel="canonical" href="${escape(origin + urlPath)}"/></head>`,
      )
      .replace(
        '<div id="root"></div>',
        `<div id="root"><main class="public-page">${body}</main></div>`,
      );
  }
  app.get("/actualites/:id", async (r, reply) => {
    const { id } = r.params as { id: string };
    const a = await db.article.findFirst({
      where: { id, publishedAt: { not: null } },
      include: { category: true },
    });
    if (!a)
      return reply
        .code(404)
        .type("text/html")
        .send(
          await html(
            "Article introuvable",
            "Cet article est indisponible.",
            '<h1>Article introuvable</h1><a href="/actualites">Actualités</a>',
            `/actualites/${id}`,
          ),
        );
    return reply
      .type("text/html")
      .send(
        await html(
          a.title,
          a.summary,
          `<a href="/actualites">Actualités</a><h1>${escape(a.title)}</h1><p>${escape(a.summary)}</p><p>${escape(a.category.name)}</p><div style="white-space:pre-wrap">${escape(a.content)}</div>`,
          `/actualites/${id}`,
        ),
      );
  });
  app.get("/actualites", async (_r, reply) => {
    const news = await db.article.findMany({
      where: { publishedAt: { not: null } },
      orderBy: { publishedAt: "desc" },
      take: 30,
    });
    return reply
      .type("text/html")
      .send(
        await html(
          "Actualités",
          "Les publications de PLANÈTE LIBIA AI.",
          `<h1>Actualités</h1>${news.map((a) => `<article><h2><a href="/actualites/${a.id}">${escape(a.title)}</a></h2><p>${escape(a.summary)}</p></article>`).join("")}`,
          "/actualites",
        ),
      );
  });
  app.get("/a-propos", async (_r, reply) =>
    reply
      .type("text/html")
      .send(
        await html(
          "À propos du responsable",
          "Grâce à José LIBIA (JO LIBIA). Fondateur et responsable de PLANÈTE LIBIA AI.",
          "<h1>Grâce à José LIBIA (JO LIBIA)</h1><p>Fils de José LIBIA et Martine Yetene.</p><h2>Fondateur et responsable de PLANÈTE LIBIA AI</h2><p>La technologie et l’intelligence artificielle au service de la population.</p>",
          "/a-propos",
        ),
      ),
  );
}
