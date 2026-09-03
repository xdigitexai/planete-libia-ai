import "dotenv/config";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, password } from "../server/core.js";
const b = z
  .object({
    ADMIN_EMAIL: z.email(),
    ADMIN_PHONE: z.string().regex(/^\+[1-9]\d{7,14}$/),
    ADMIN_USERNAME: z.string().regex(/^[a-z0-9_]{3,30}$/),
    ADMIN_NAME: z.string().min(2),
    ADMIN_PASSWORD: password,
  })
  .parse(process.env);
await db.user.create({
  data: {
    email: b.ADMIN_EMAIL.toLowerCase(),
    phone: b.ADMIN_PHONE,
    username: b.ADMIN_USERNAME,
    name: b.ADMIN_NAME,
    passwordHash: await bcrypt.hash(b.ADMIN_PASSWORD, 12),
    verifiedAt: new Date(),
    role: "ADMIN",
  },
});
await db.$disconnect();
console.log(
  "Administrator created. Remove ADMIN_PASSWORD from the environment. Enable 2FA before public use.",
);
