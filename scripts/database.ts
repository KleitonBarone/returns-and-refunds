import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { readConfig } from "../apps/server/src/config.ts";
import { connectDatabase } from "../apps/server/src/db.ts";
import { seed } from "../apps/server/src/seed.ts";

export async function prepareDatabase(url: string, runId: string, disposable: boolean) {
  const { db, pool } = connectDatabase(url);
  try {
    await migrate(db, {
      migrationsFolder: fileURLToPath(new URL("../apps/server/db", import.meta.url)),
    });
    await seed(db, runId, disposable);
  } finally {
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const config = readConfig();
  const { db, pool } = connectDatabase(config.databaseUrl);
  try {
    if (process.argv[2] === "migrate")
      await migrate(db, {
        migrationsFolder: fileURLToPath(new URL("../apps/server/db", import.meta.url)),
      });
    else if (process.argv[2] === "seed") await seed(db, config.runId, false);
    else throw new Error("Use db:migrate or db:seed");
  } finally {
    await pool.end();
  }
}
