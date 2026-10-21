import { randomUUID } from "node:crypto";
import { createApp } from "../../apps/server/src/app.ts";
import { readConfig } from "../../apps/server/src/config.ts";
import { connectDatabase } from "../../apps/server/src/db.ts";
import { allocateMinor } from "../../apps/server/src/domain.ts";
import { orderLines, orders, orderUnits } from "../../apps/server/src/schema.ts";

export async function testContext(services?: Parameters<typeof createApp>[2]) {
  const config = readConfig();
  if (!config.runId.startsWith("codex-returns-test-"))
    throw new Error("Integration tests require an isolated test run");
  const { db, pool } = connectDatabase(config.databaseUrl);
  const app = await createApp(db, config, services);
  async function login(personaId: string) {
    const response = await app.inject({
      method: "POST",
      url: "/api/session",
      headers: { origin: config.webOrigin },
      payload: { personaId },
    });
    if (response.statusCode !== 200) throw new Error(`Persona sign-in failed: ${response.body}`);
    const cookies = response.headers["set-cookie"];
    const cookie = (Array.isArray(cookies) ? cookies[0] : cookies)?.split(";")[0];
    if (!cookie) throw new Error("Session cookie missing");
    return { cookie, origin: config.webOrigin };
  }
  async function fixture(customerId = "customer-maya", deliveredAt = "2026-09-20T12:00:00.000Z") {
    const id = `fixture-${randomUUID()}`;
    const lineId = `${id}-line`;
    await db.insert(orders).values({
      id,
      number: "TEST-1001",
      merchantId: "northline",
      customerId,
      paymentRef: `payment-${id}`,
      capturedMinor: 10001,
      deliveredAt,
    });
    await db.insert(orderLines).values({
      id: lineId,
      orderId: id,
      name: "Test garment",
      variant: "Indigo / M",
      quantity: 3,
      netMinor: 10001,
    });
    await db.insert(orderUnits).values(
      allocateMinor(10001, 3).map((netMinor, index) => ({
        id: `${lineId}:${index + 1}`,
        lineId,
        position: index + 1,
        netMinor,
      })),
    );
    return { id, lineId };
  }
  function input(order: Awaited<ReturnType<typeof fixture>>, quantity = 1) {
    return {
      orderId: order.id,
      requestKey: randomUUID(),
      reason: "The fit is too large",
      items: [{ lineId: order.lineId, quantity }],
    };
  }
  return {
    config,
    db,
    pool,
    app,
    login,
    fixture,
    input,
    close: async () => {
      await app.close();
      await pool.end();
    },
  };
}
