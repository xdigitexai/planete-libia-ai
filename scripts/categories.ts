import "dotenv/config";
import { db } from "../server/core.js";
for (const name of ["Technologie", "Éducation", "Société", "Actualités"])
  await db.category.upsert({ where: { name }, create: { name }, update: {} });
await db.$disconnect();
