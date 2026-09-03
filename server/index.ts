import "dotenv/config";
import { buildApp } from "./app.js";
import { db } from "./core.js";
const app = await buildApp({ logger: true });
await app.listen({ port: Number(process.env.PORT || 3000), host: "0.0.0.0" });
for (const sig of ["SIGINT", "SIGTERM"])
  process.on(sig, () => {
    void app
      .close()
      .then(() => db.$disconnect())
      .then(() => process.exit(0));
  });
