import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  auditEntries,
  orderUnits,
  returnRequests,
  returnReviews,
  returnUnits,
} from "../../apps/server/src/schema.ts";
import { type actionInput, returnDetailContract } from "../../packages/contracts/src/index.ts";
import { testContext } from "./helpers.ts";

const context = await testContext();
const { app, db, pool, login, fixture, input } = context;
afterAll(context.close);
async function requested() {
  const order = await fixture();
  const response = await app.inject({
    method: "POST",
    url: "/api/returns",
    headers: await login("customer-maya"),
    payload: input(order, 2),
  });
  expect(response.statusCode).toBe(201);
  return { order, request: returnDetailContract.assert(response.json()) };
}
async function act(
  id: string,
  action: typeof actionInput.infer.action,
  expectedStatus: typeof actionInput.infer.expectedStatus,
  persona = action === "approve" || action === "reject" ? "support-ava" : "warehouse-jules",
) {
  return app.inject({
    method: "POST",
    url: `/api/returns/${id}/actions`,
    headers: await login(persona),
    payload: {
      action,
      expectedStatus,
      reason: "Verified the returned items",
      correlationId: randomUUID(),
    },
  });
}
describe("decisions and inspection", () => {
  it("records approval, receipt and passing inspection in order under a fixed clock", async () => {
    const { request } = await requested();
    expect((await act(request.id, "approve", "requested")).statusCode).toBe(200);
    expect((await act(request.id, "receive", "approved")).statusCode).toBe(200);
    const response = await act(request.id, "pass_inspection", "received");
    const result = returnDetailContract.assert(response.json());
    expect(result.status).toBe("inspection_passed");
    expect(result.closureReason).toBeNull();
    expect(result.reviews.map((review) => review.outcome).sort()).toEqual(["approved", "passed"]);
    expect(result.history.map((event) => event.toStatus)).toEqual([
      "requested",
      "approved",
      "received",
      "inspection_passed",
    ]);
    expect(result.history.map((event) => event.actorName)).toEqual([
      "Maya Chen",
      "Ava Brooks",
      "Jules Park",
      "Jules Park",
    ]);
    expect(new Set(result.history.map((event) => event.correlationId)).size).toBe(4);
    const customer = returnDetailContract.assert(
      (
        await app.inject({
          method: "GET",
          url: `/api/returns/${request.id}`,
          headers: await login("customer-maya"),
        })
      ).json(),
    );
    expect(customer.history).toEqual(result.history);
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
    ).toHaveLength(2);
  });
  it("closes rejected requests, preserves the reason and releases only their claims", async () => {
    const { request, order } = await requested();
    const response = await act(request.id, "reject", "requested");
    const result = returnDetailContract.assert(response.json());
    expect(result).toMatchObject({ status: "closed", closureReason: "rejected" });
    expect(result.reviews[0]).toMatchObject({
      kind: "decision",
      outcome: "rejected",
      reason: "Verified the returned items",
    });
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
    ).toHaveLength(0);
    const replacement = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: await login("customer-maya"),
      payload: input(order, 3),
    });
    expect(replacement.statusCode).toBe(201);
    expect((await act(request.id, "approve", "requested")).statusCode).toBe(409);
    expect(
      await db.select().from(returnUnits).where(eq(returnUnits.returnId, request.id)),
    ).toHaveLength(2);
  });
  it("preserves a failed inspection and closure atomically without reviving consumed units", async () => {
    const { request, order } = await requested();
    await db
      .update(orderUnits)
      .set({ consumed: 1 })
      .where(eq(orderUnits.id, `${order.lineId}:3`));
    await act(request.id, "approve", "requested");
    await act(request.id, "receive", "approved");
    const result = returnDetailContract.assert(
      (await act(request.id, "fail_inspection", "received")).json(),
    );
    expect(result).toMatchObject({ status: "closed", closureReason: "inspection_failed" });
    expect(result.reviews.find((review) => review.kind === "inspection")?.outcome).toBe("failed");
    expect(result.history.map((event) => event.toStatus)).toEqual([
      "requested",
      "approved",
      "received",
      "inspection_failed",
      "closed",
    ]);
    expect(result.history.at(-1)?.correlationId).toBe(result.history.at(-2)?.correlationId);
    const response = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: await login("customer-maya"),
      payload: input(order, 3),
    });
    expect(response.statusCode).toBe(409);
    const available = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: await login("customer-maya"),
      payload: input(order, 2),
    });
    expect(available.statusCode).toBe(201);
    expect(
      returnDetailContract
        .assert(available.json())
        .items.every((item) => item.unitId !== `${order.lineId}:3`),
    ).toBe(true);
  });
  it("rejects unauthorized, stale and out-of-order actions without history writes", async () => {
    const { request } = await requested();
    for (const persona of ["customer-maya", "warehouse-jules", "finance-sam"])
      expect((await act(request.id, "approve", "requested", persona)).statusCode).toBe(403);
    expect((await act(request.id, "approve", "requested", "support-other")).statusCode).toBe(404);
    expect((await act(request.id, "receive", "requested")).statusCode).toBe(409);
    expect((await act(request.id, "pass_inspection", "received")).statusCode).toBe(409);
    expect((await act(request.id, "approve", "approved")).statusCode).toBe(409);
    const invalid = await app.inject({
      method: "POST",
      url: `/api/returns/${request.id}/actions`,
      headers: await login("support-ava"),
      payload: {
        action: "approve",
        expectedStatus: "requested",
        reason: "   ",
        correlationId: randomUUID(),
      },
    });
    expect(invalid.statusCode).toBe(422);
    expect(
      await db.select().from(auditEntries).where(eq(auditEntries.returnId, request.id)),
    ).toHaveLength(1);
    expect(
      await db.select().from(returnReviews).where(eq(returnReviews.returnId, request.id)),
    ).toHaveLength(0);
  });
  it("serializes competing approval and rejection under the order lock", async () => {
    const { request, order } = await requested();
    const headers = await login("support-ava");
    const blocker = await pool.connect();
    await blocker.query("begin");
    await blocker.query("select id from orders where id=$1 for update", [order.id]);
    const pending = ["approve", "reject"].map((action) =>
      app.inject({
        method: "POST",
        url: `/api/returns/${request.id}/actions`,
        headers,
        payload: {
          action,
          expectedStatus: "requested",
          reason: "Verified by support",
          correlationId: randomUUID(),
        },
      }),
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
      expect((await Promise.all(pending)).map((response) => response.statusCode).sort()).toEqual([
        200, 409,
      ]);
      expect(
        await db.select().from(returnReviews).where(eq(returnReviews.returnId, request.id)),
      ).toHaveLength(1);
      expect(
        await db.select().from(auditEntries).where(eq(auditEntries.returnId, request.id)),
      ).toHaveLength(2);
      const [result] = await db
        .select()
        .from(returnRequests)
        .where(eq(returnRequests.id, request.id));
      const claims = await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true)));
      expect(claims).toHaveLength(result?.status === "approved" ? 2 : 0);
    } finally {
      await blocker.query("rollback");
      blocker.release();
      await Promise.all(pending);
    }
  });
  it("rolls back the review, closure and claim release when audit storage rejects the write", async () => {
    const { request } = await requested();
    // The generated UUID is test-owned. PostgreSQL DDL cannot bind this check value.
    await db.execute(
      sql.raw(
        `alter table audit_entries add constraint injected_audit_failure check (return_id <> '${request.id}' or from_status is null)`,
      ),
    );
    try {
      expect((await act(request.id, "reject", "requested")).statusCode).toBe(500);
      const [unchanged] = await db
        .select()
        .from(returnRequests)
        .where(eq(returnRequests.id, request.id));
      expect(unchanged).toMatchObject({ status: "requested", closureReason: null });
      expect(
        await db.select().from(returnReviews).where(eq(returnReviews.returnId, request.id)),
      ).toHaveLength(0);
      expect(
        await db.select().from(auditEntries).where(eq(auditEntries.returnId, request.id)),
      ).toHaveLength(1);
      expect(
        await db
          .select()
          .from(returnUnits)
          .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
      ).toHaveLength(2);
    } finally {
      await db.execute(sql`alter table audit_entries drop constraint injected_audit_failure`);
    }
  });
});
