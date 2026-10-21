import { createApp } from "./app.ts";
import { readConfig } from "./config.ts";
import { connectDatabase } from "./db.ts";

const config = readConfig();
const { db, pool } = connectDatabase(config.databaseUrl);
const app = await createApp(db, config);
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Returns API ready for ${config.runId}`);
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
