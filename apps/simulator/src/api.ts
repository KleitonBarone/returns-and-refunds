import { createSimulator } from "./app.ts";
import { readSimulatorConfig } from "./config.ts";
import { connectSimulator } from "./db.ts";
import { deliverBatch } from "./events.ts";

const config = readSimulatorConfig();
const { db, pool } = connectSimulator(config.databaseUrl);
const app = await createSimulator(db, config);
let pending: Promise<unknown> | undefined;
const timer =
  process.env.SIMULATOR_DELIVERY_AUTOSTART === "1"
    ? setInterval(() => {
        if (pending) return;
        pending = deliverBatch(db, config)
          .catch((error: unknown) =>
            console.error(error instanceof Error ? error.message : "Delivery failed"),
          )
          .finally(() => {
            pending = undefined;
          });
      }, 500)
    : undefined;
app.addHook("onClose", async () => {
  if (timer) clearInterval(timer);
  await pending;
});
await app.listen({ port: config.port, host: "127.0.0.1" });
console.log(`Payment simulator ready for ${config.runId}`);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
