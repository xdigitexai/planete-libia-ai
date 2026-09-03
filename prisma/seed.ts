import "dotenv/config";
import bcrypt from "bcryptjs";
import { db, password } from "../server/core.js";
if (process.env.NODE_ENV === "production")
  throw new Error("Development seed is disabled in production.");
const pw = password.parse(process.env.SEED_PASSWORD);
const user = await db.user.upsert({
  where: { email: "community@example.test" },
  update: {},
  create: {
    name: "Communauté Planète Libia",
    username: "communaute_demo",
    email: "community@example.test",
    phone: "+243800000001",
    passwordHash: await bcrypt.hash(pw, 12),
    verifiedAt: new Date(),
  },
});
for (const name of ["Technologie", "Éducation", "Société", "Actualités"])
  await db.category.upsert({ where: { name }, update: {}, create: { name } });
const category = await db.category.findFirstOrThrow({
  where: { name: "Éducation" },
});
if (
  !(await db.article.findFirst({
    where: { title: "Bienvenue dans votre espace communautaire" },
  }))
)
  await db.article.create({
    data: {
      authorId: user.id,
      categoryId: category.id,
      title: "Bienvenue dans votre espace communautaire",
      summary:
        "Un exemple éditorial pour découvrir les fonctionnalités en développement.",
      content:
        "Cet article est une donnée de développement. Découvrez les conversations, les groupes et votre espace personnel. Supprimez ces données avant une ouverture publique.",
      publishedAt: new Date(),
    },
  });
if (
  !(await db.room.findFirst({ where: { name: "Communauté de développement" } }))
)
  await db.room.create({
    data: {
      name: "Communauté de développement",
      kind: "GROUP",
      members: { create: { userId: user.id, role: "OWNER" } },
    },
  });
await db.$disconnect();
console.log(
  "Development seed completed. Password supplied by SEED_PASSWORD; no default password.",
);
