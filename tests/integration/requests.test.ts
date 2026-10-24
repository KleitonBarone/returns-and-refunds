import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditEntries,
  orderUnits,
  returnRequests,
  returnUnits,
} from "../../apps/server/src/schema.ts";
import {
  ordersContract,
  returnDetailContract,
  returnsContract,
} from "../../packages/contracts/src/index.ts";
import { testContext } from "./helpers.ts";

const context = await testContext();
const { app, db, pool, login, fixture, input, config } = context;
afterAll(context.close);
describe("customer return requests", () => {
  it("creates a partial return with policy and exact unit-value snapshots", async () => {
    const order = await fixture();
    const headers = await login("customer-maya");
    const response = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers,
      payload: input(order, 2),
    });
    expect(response.statusCode).toBe(201);
    const request = returnDetailContract.assert(response.json());
    expect(request.amountMinor).toBe(6668);
    expect(request.items).toHaveLength(2);
    expect(request.history).toHaveLength(1);
    expect(request.policyVersion).toBe("merchandise-30d-v1");
    const available = ordersContract
      .assert((await app.inject({ method: "GET", url: "/api/orders", headers })).json())
      .find((item) => item.id === order.id);
    expect(available?.lines[0]?.unitValues).toEqual([3333]);
    const queue = returnsContract.assert(
      (
        await app.inject({
          method: "GET",
          url: "/api/returns",
          headers: await login("support-ava"),
        })
      ).json(),
    );
    expect(queue.some((item) => item.id === request.id)).toBe(true);
  });
  it("deduplicates submission and rejects changed content under the same key", async () => {
    const order = await fixture();
    const headers = await login("customer-maya");
    const payload = input(order);
    const first = await app.inject({ method: "POST", url: "/api/returns", headers, payload });
    const second = await app.inject({ method: "POST", url: "/api/returns", headers, payload });
    const request = returnDetailContract.assert(first.json());
    expect(returnDetailContract.assert(second.json()).id).toBe(request.id);
    const reordered = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers,
      payload: {
        ...payload,
        items: payload.items.map(({ lineId, quantity }) => ({ quantity, lineId })),
      },
    });
    expect(reordered.statusCode).toBe(201);
    expect(returnDetailContract.assert(reordered.json()).id).toBe(request.id);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.returnId, request.id)),
    ).toHaveLength(1);
    const changed = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers,
      payload: { ...payload, reason: "Different reason" },
    });
    expect(changed.statusCode).toBe(409);
  });
  it("replays retained pre-canonical requests without accepting changed content", async () => {
    const order = await fixture();
    const otherOrder = await fixture();
    const headers = await login("customer-maya");
    const original = input(order);
    const payload = {
      ...original,
      items: original.items.map(({ lineId, quantity }) => ({ quantity, lineId })),
    };
    const first = await app.inject({ method: "POST", url: "/api/returns", headers, payload });
    const request = returnDetailContract.assert(first.json());
    const [saved] = await db.select().from(returnRequests).where(eq(returnRequests.id, request.id));
    const legacy = createHash("sha256")
      .update(
        JSON.stringify({
          orderId: payload.orderId,
          reason: payload.reason.trim(),
          items: payload.items,
        }),
      )
      .digest("hex");
    expect(legacy).not.toBe(saved?.fingerprint);
    await db
      .update(returnRequests)
      .set({ fingerprint: legacy })
      .where(eq(returnRequests.id, request.id));
    for (const changed of [
      { ...payload, reason: "A different request" },
      { ...payload, items: [{ quantity: 2, lineId: order.lineId }] },
      { ...payload, orderId: otherOrder.id },
    ]) {
      const result = await app.inject({
        method: "POST",
        url: "/api/returns",
        headers,
        payload: changed,
      });
      expect(result.statusCode).toBe(409);
    }
    for (const items of [payload.items, original.items]) {
      const replay = await app.inject({
        method: "POST",
        url: "/api/returns",
        headers,
        payload: { ...payload, items },
      });
      expect(replay.statusCode).toBe(201);
      expect(returnDetailContract.assert(replay.json()).id).toBe(request.id);
    }
    const [upgraded] = await db
      .select()
      .from(returnRequests)
      .where(eq(returnRequests.id, request.id));
    expect(upgraded?.fingerprint).toBe(saved?.fingerprint);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.returnId, request.id)),
    ).toHaveLength(1);
  });
  it("blocks expired/future deliveries and malformed or excessive quantities", async () => {
    const headers = await login("customer-maya");
    for (const date of ["2026-08-01T12:00:00.000Z", "2026-10-02T12:00:00.000Z"]) {
      const order = await fixture("customer-maya", date);
      expect(
        (await app.inject({ method: "POST", url: "/api/returns", headers, payload: input(order) }))
          .statusCode,
      ).toBe(422);
    }
    const order = await fixture();
    for (const quantity of [0, -1, 1.5, 51])
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/api/returns",
            headers,
            payload: input(order, quantity),
          })
        ).statusCode,
      ).toBe(400);
    expect(
      (await app.inject({ method: "POST", url: "/api/returns", headers, payload: input(order, 4) }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/returns",
          headers,
          payload: { ...input(order), items: [] },
        })
      ).statusCode,
    ).toBe(422);
    expect(
      await db.select().from(returnRequests).where(eq(returnRequests.orderId, order.id)),
    ).toHaveLength(0);
  });
  it("enforces customer and merchant ownership for reads and writes", async () => {
    const ownedByLeo = await fixture("customer-leo");
    const maya = await login("customer-maya");
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/returns",
          headers: maya,
          payload: input(ownedByLeo),
        })
      ).statusCode,
    ).toBe(404);
    const order = await fixture();
    const response = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: maya,
      payload: input(order),
    });
    const request = returnDetailContract.assert(response.json());
    for (const persona of ["customer-leo", "customer-other", "support-other"]) {
      const headers = await login(persona);
      expect(
        (await app.inject({ method: "GET", url: `/api/returns/${request.id}`, headers }))
          .statusCode,
      ).toBe(404);
      expect(
        returnsContract
          .assert((await app.inject({ method: "GET", url: "/api/returns", headers })).json())
          .some((item) => item.id === request.id),
      ).toBe(false);
    }
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/returns",
          headers: await login("support-ava"),
          payload: input(order),
        })
      ).statusCode,
    ).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/orders" })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/session",
          payload: { personaId: "customer-maya" },
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/returns",
          headers: maya,
          payload: { ...input(order), merchantId: "other-store" },
        })
      ).statusCode,
    ).toBe(400);
  });
  it("serializes overlapping requests while both transactions are waiting on the order", async () => {
    const order = await fixture();
    const headers = await login("customer-maya");
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select id from orders where id=$1 for update", [order.id]);
    const pending = [1, 2].map(() =>
      app.inject({ method: "POST", url: "/api/returns", headers, payload: input(order, 3) }),
    );
    try {
      const deadline = Date.now() + 5000;
      let waiting = 0;
      while (Date.now() < deadline) {
        const result = await pool.query<{ count: number }>(
          "select count(*)::int as count from pg_stat_activity where wait_event_type='Lock' and query ilike '%for update%'",
        );
        waiting = result.rows[0]?.count ?? 0;
        if (waiting >= 2) break;
        await delay(10);
      }
      expect(waiting).toBeGreaterThanOrEqual(2);
      await blocker.query("commit");
      const responses = await Promise.all(pending);
      expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 409]);
      const requests = await db
        .select()
        .from(returnRequests)
        .where(eq(returnRequests.orderId, order.id));
      expect(requests).toHaveLength(1);
      const ids = requests.map((request) => request.id);
      expect(
        await db
          .select()
          .from(returnUnits)
          .where(and(inArray(returnUnits.returnId, ids), eq(returnUnits.active, true))),
      ).toHaveLength(3);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await Promise.all(pending);
    }
  });
  it("does not reserve previously consumed units", async () => {
    const order = await fixture();
    await db
      .update(orderUnits)
      .set({ consumed: 1 })
      .where(eq(orderUnits.id, `${order.lineId}:1`));
    const response = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: await login("customer-maya"),
      payload: input(order, 2),
    });
    expect(response.statusCode).toBe(201);
    const request = returnDetailContract.assert(response.json());
    expect(request.amountMinor).toBe(6667);
    expect(request.items.every((item) => item.unitId !== `${order.lineId}:1`)).toBe(true);
    const identity = await db.execute(
      sql`select run_id from environment_identity where id='returns-demo'`,
    );
    expect(identity.rows[0]).toMatchObject({ run_id: config.runId });
  });
});
