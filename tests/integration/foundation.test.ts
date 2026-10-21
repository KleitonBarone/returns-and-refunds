import { eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../../apps/server/src/app.ts";
import { readConfig } from "../../apps/server/src/config.ts";
import { connectDatabase } from "../../apps/server/src/db.ts";
import { customers, orders, orderUnits } from "../../apps/server/src/schema.ts";
import { seed } from "../../apps/server/src/seed.ts";

const config = readConfig();
const { db, pool } = connectDatabase(config.databaseUrl);
afterAll(() => pool.end());
describe("real PostgreSQL foundation", () => {
  it("seeds idempotently without changing unit values", async () => {
    await seed(db, config.runId, true);
    const units = await db.select().from(orderUnits).where(eq(orderUnits.lineId, "order-1042-tee"));
    expect(units).toHaveLength(3);
    expect(units.reduce((sum, unit) => sum + unit.netMinor, 0)).toBe(10500);
  });
  it("rejects a cross-merchant order at the database boundary", async () => {
    const [customer] = await db.select().from(customers).where(eq(customers.id, "customer-other"));
    expect(customer?.merchantId).toBe("other-store");
    await expect(
      db.insert(orders).values({
        id: "invalid",
        number: "invalid",
        merchantId: "northline",
        customerId: "customer-other",
        capturedMinor: 100,
        paymentRef: "invalid",
        deliveredAt: config.demoNow,
      }),
    ).rejects.toThrow();
    await expect(
      db.execute(
        sql`insert into order_units (id,line_id,position,net_minor) values ('bad','order-1042-tee',9,-1)`,
      ),
    ).rejects.toThrow();
  });
  it("identifies its actual ready database through the API", async () => {
    const app = await createApp(db, config);
    const response = await app.inject({ method: "GET", url: "/api/health" });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ runId: config.runId, database: "ready" });
    await app.close();
  });
});
