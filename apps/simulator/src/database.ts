import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectSimulator } from "./db.ts";
import { captures, simulatorIdentity } from "./schema.ts";
export async function prepareSimulatorDatabase(url: string, runId: string, disposable: boolean) {
  const { db, pool } = connectSimulator(url);
  try {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL("../db", import.meta.url)) });
    await db.transaction(async (tx) => {
      await tx
        .insert(simulatorIdentity)
        .values({ id: "payment-simulator", runId, disposable })
        .onConflictDoNothing();
      const [identity] = await tx
        .select()
        .from(simulatorIdentity)
        .where(eq(simulatorIdentity.id, "payment-simulator"));
      if (identity?.runId !== runId || identity.disposable !== disposable)
        throw new Error("Simulator database identity mismatch");
      await tx
        .insert(captures)
        .values([
          {
            merchantId: "northline",
            paymentRef: "payment-order-1042",
            capturedMinor: 15500,
            currency: "USD",
          },
          {
            merchantId: "northline",
            paymentRef: "payment-order-1031",
            capturedMinor: 15500,
            currency: "USD",
          },
          {
            merchantId: "northline",
            paymentRef: "payment-order-1043",
            capturedMinor: 15500,
            currency: "USD",
          },
          {
            merchantId: "other-store",
            paymentRef: "payment-order-other",
            capturedMinor: 15500,
            currency: "USD",
          },
        ])
        .onConflictDoNothing();
    });
  } finally {
    await pool.end();
  }
}
