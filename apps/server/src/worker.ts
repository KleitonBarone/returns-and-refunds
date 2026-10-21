import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import { readConfig } from "./config.ts";
import { connectDatabase } from "./db.ts";
import { createPaymentProvider } from "./provider.ts";
import { processRefundJob } from "./refund-worker.ts";
import { environmentIdentity, workerHeartbeat } from "./schema.ts";

const config = readConfig();
const provider = createPaymentProvider();
const { db, pool } = connectDatabase(config.databaseUrl);
const [identity] = await db
  .select()
  .from(environmentIdentity)
  .where(eq(environmentIdentity.id, "returns-demo"));
if (identity?.runId !== config.runId) throw new Error("Worker database identity mismatch");
let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    stopping = true;
  });
try {
  console.log(`Refund worker ready for ${config.runId}`);
  while (!stopping) {
    try {
      const heartbeat = {
        id: "refund-worker",
        runId: config.runId,
        pid: process.pid,
        lastSeenAt: new Date().toISOString(),
      };
      await db
        .insert(workerHeartbeat)
        .values(heartbeat)
        .onConflictDoUpdate({ target: workerHeartbeat.id, set: heartbeat });
      await processRefundJob(db, provider, config.demoNow);
    } catch (error) {
      console.error(error instanceof Error ? error.message : "Refund worker failure");
    }
    await delay(250);
  }
} finally {
  await pool.end();
}
