import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import {
  createPaymentProvider,
  type PaymentProvider,
  readProviderConfig,
} from "../../apps/server/src/provider.ts";
import {
  claimRefundJob,
  completeRefundJob,
  processRefundJob,
  REFUND_LEASE_MS,
} from "../../apps/server/src/refund-worker.ts";
import {
  memberships,
  orders,
  orderUnits,
  refundAttempts,
  refundJobs,
  refundOperations,
  refundReceipts,
  returnUnits,
  users,
} from "../../apps/server/src/schema.ts";
import { type ReturnView, returnDetailContract } from "../../packages/contracts/src/index.ts";
import { type controlInput, simulatorDiagnostics } from "../../packages/contracts/src/payment.ts";
import { testContext } from "./helpers.ts";

const context = await testContext();
const { app, db, pool, fixture, input, login, config } = context;
const providerConfig = readProviderConfig();
const provider = createPaymentProvider(providerConfig);
afterAll(context.close);
async function simulator(path: string, body?: unknown) {
  const response = await fetch(`${providerConfig.url}/control/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.SIMULATOR_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  if (!response.ok) throw new Error(`Simulator control failed (${response.status})`);
  const result: unknown = await response.json();
  return result;
}
async function ready(
  existingOrder?: Awaited<ReturnType<typeof fixture>>,
  quantity = 1,
  inspected = true,
) {
  const order = existingOrder ?? (await fixture());
  const paymentRef = `payment-${order.id}`;
  // One capture per test order, even when two partial returns share it.
  const capture = await fetch(`${providerConfig.url}/control/captures`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.SIMULATOR_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      merchantId: "northline",
      paymentRef,
      capturedMinor: 10001,
      currency: "USD",
    }),
  });
  expect([201, 409]).toContain(capture.status);
  const created = await app.inject({
    method: "POST",
    url: "/api/returns",
    headers: await login("customer-maya"),
    payload: input(order, quantity),
  });
  expect(created.statusCode).toBe(201);
  let request = returnDetailContract.assert(created.json());
  if (inspected) {
    for (const [action, expectedStatus, persona] of [
      ["approve", "requested", "support-ava"],
      ["receive", "approved", "warehouse-jules"],
      ["pass_inspection", "received", "warehouse-jules"],
    ] as const) {
      const result = await app.inject({
        method: "POST",
        url: `/api/returns/${request.id}/actions`,
        headers: await login(persona),
        payload: {
          action,
          expectedStatus,
          reason: "Verified the return",
          correlationId: randomUUID(),
        },
      });
      expect(result.statusCode).toBe(200);
      request = returnDetailContract.assert(result.json());
    }
  }
  return { order, request, paymentRef };
}
async function configure(paymentRef: string, mode: typeof controlInput.infer.mode) {
  await simulator("payments", {
    merchantId: "northline",
    paymentRef,
    mode,
    responseDelayMs: 1000,
    eventDelayMs: 0,
    eventCopies: 1,
  });
}
async function submit(
  request: ReturnView,
  headers?: Awaited<ReturnType<typeof login>>,
  amount = request.amountMinor,
) {
  return app.inject({
    method: "POST",
    url: `/api/returns/${request.id}/refund`,
    headers: headers ?? (await login("finance-sam")),
    payload: {
      expectedAmountMinor: amount,
      reason: "Inspection passed; refund original payment",
      correlationId: randomUUID(),
    },
  });
}
async function operation(request: ReturnView) {
  const [result] = await db
    .select()
    .from(refundOperations)
    .where(eq(refundOperations.returnId, request.id));
  if (!result) throw new Error("Refund operation missing");
  return result;
}
async function detail(request: ReturnView) {
  return returnDetailContract.assert(
    (
      await app.inject({
        method: "GET",
        url: `/api/returns/${request.id}`,
        headers: await login("customer-maya"),
      })
    ).json(),
  );
}
async function ledgerFor(key: string) {
  const result = simulatorDiagnostics.assert(await simulator("diagnostics"));
  const receipt = result.refunds.find((row) => row.idempotencyKey === key);
  return result.ledger.filter((row) => row.refundId === receipt?.id);
}
async function run(operationId: string, now?: number, adapter: PaymentProvider = provider) {
  return processRefundJob(db, adapter, config.demoNow, { operationId, now });
}
async function compete(orderId: string, tasks: Array<() => ReturnType<typeof submit>>) {
  const blocker = await pool.connect();
  await blocker.query("begin");
  await blocker.query("select id from orders where id=$1 for update", [orderId]);
  const pending = tasks.map((task) => task());
  try {
    await expect
      .poll(
        async () =>
          (
            await pool.query<{ count: number }>(
              "select count(*)::int as count from pg_stat_activity where wait_event_type='Lock' and query ilike '%for update%'",
            )
          ).rows[0]?.count ?? 0,
        { timeout: 3000 },
      )
      .toBeGreaterThanOrEqual(2);
    await blocker.query("commit");
    return await Promise.all(pending);
  } finally {
    await blocker.query("rollback");
    blocker.release();
    await Promise.all(pending);
  }
}
describe("durable refund processing", () => {
  it("persists one immutable intent, outbox job and audit before provider contact", async () => {
    const { request } = await ready();
    const first = await submit(request);
    expect(first.statusCode).toBe(202);
    const initial = returnDetailContract.assert(first.json());
    expect(initial.refund).toMatchObject({ status: "pending", amountMinor: 3334 });
    const replay = returnDetailContract.assert((await submit(request)).json());
    expect(replay.refund?.id).toBe(initial.refund?.id);
    const stored = await operation(request);
    expect(
      await db.select().from(refundJobs).where(eq(refundJobs.operationId, stored.id)),
    ).toHaveLength(1);
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(0);
    expect(replay.history.filter((event) => event.event === "Refund requested")).toHaveLength(1);
  });
  it("checks role, merchant, passing inspection and exact confirmed amount", async () => {
    const { request } = await ready();
    for (const persona of ["customer-maya", "support-ava", "warehouse-jules"])
      expect((await submit(request, await login(persona))).statusCode).toBe(403);
    const outsider = `finance-${randomUUID()}`;
    await db.insert(users).values({ id: outsider, name: "Other merchant finance" });
    await db
      .insert(memberships)
      .values({ userId: outsider, merchantId: "other-store", role: "finance" });
    expect((await submit(request, await login(outsider))).statusCode).toBe(404);
    expect((await submit(request, undefined, request.amountMinor + 1)).statusCode).toBe(409);
    const uninspected = await ready(undefined, 1, false);
    expect((await submit(uninspected.request)).statusCode).toBe(409);
    expect(
      await db.select().from(refundOperations).where(eq(refundOperations.returnId, request.id)),
    ).toHaveLength(0);
  });
  it("rolls back intent and job when the audit write fails", async () => {
    const { request } = await ready();
    const before = (await db.select().from(refundJobs)).length;
    await db.execute(
      sql.raw(
        `alter table audit_entries add constraint injected_refund_audit_failure check (return_id <> '${request.id}' or event <> 'Refund requested')`,
      ),
    );
    try {
      expect((await submit(request)).statusCode).toBe(500);
      expect(
        await db.select().from(refundOperations).where(eq(refundOperations.returnId, request.id)),
      ).toHaveLength(0);
      expect(await db.select().from(refundJobs)).toHaveLength(before);
      expect(
        (await detail(request)).history.filter((event) => event.event === "Refund requested"),
      ).toHaveLength(0);
    } finally {
      await db.execute(
        sql`alter table audit_entries drop constraint injected_refund_audit_failure`,
      );
    }
  });
  it("deduplicates competing finance submissions under the order lock", async () => {
    const { request, order } = await ready();
    const headers = await login("finance-sam");
    const responses = await compete(order.id, [
      () => submit(request, headers),
      () => submit(request, headers),
    ]);
    expect(responses.map((response) => response.statusCode)).toEqual([202, 202]);
    expect(
      new Set(responses.map((response) => returnDetailContract.assert(response.json()).refund?.id))
        .size,
    ).toBe(1);
    expect(
      await db.select().from(refundOperations).where(eq(refundOperations.returnId, request.id)),
    ).toHaveLength(1);
  });
  it("serializes different returns against order-wide reserved capacity", async () => {
    const first = await ready();
    const second = await ready(first.order);
    // Reduced historical capture deliberately exercises the guard independently of unit claims.
    await db.update(orders).set({ capturedMinor: 5000 }).where(eq(orders.id, first.order.id));
    const headers = await login("finance-sam");
    const responses = await compete(first.order.id, [
      () => submit(first.request, headers),
      () => submit(second.request, headers),
    ]);
    expect(responses.map((response) => response.statusCode).sort()).toEqual([202, 409]);
    expect(
      await db.select().from(refundOperations).where(eq(refundOperations.orderId, first.order.id)),
    ).toHaveLength(1);
  });
  it("confirms one provider refund and atomically closes and consumes the selected units", async () => {
    const { request, order } = await ready(undefined, 2);
    await submit(request);
    const stored = await operation(request);
    expect(await run(stored.id)).toMatchObject({ applied: true, status: "succeeded" });
    const result = await detail(request);
    expect(result).toMatchObject({
      status: "closed",
      closureReason: "refunded",
      refund: { status: "succeeded", amountMinor: 6668 },
    });
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
    expect(
      await db
        .select()
        .from(orderUnits)
        .where(and(eq(orderUnits.lineId, order.lineId), eq(orderUnits.consumed, 1))),
    ).toHaveLength(2);
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
    ).toHaveLength(0);
    expect(returnDetailContract.assert((await submit(request)).json()).refund?.id).toBe(stored.id);
    expect(
      (await detail(request)).history.filter((event) => event.event === "Refund succeeded"),
    ).toHaveLength(1);
    const attempted = await app.inject({
      method: "POST",
      url: "/api/returns",
      headers: await login("customer-maya"),
      payload: input(order, 2),
    });
    expect(attempted.statusCode).toBe(409);
  });
  it("retries a pre-write failure with the same key and persisted backoff", async () => {
    const { request, paymentRef } = await ready();
    await configure(paymentRef, "retry_once");
    await submit(request);
    const stored = await operation(request);
    expect(await run(stored.id)).toMatchObject({ status: "pending" });
    const [job] = await db.select().from(refundJobs).where(eq(refundJobs.operationId, stored.id));
    expect(job?.completedAt).toBeNull();
    expect(job?.attempts).toBe(1);
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(0);
    expect(await run(stored.id, Date.parse(job?.runAt ?? "") + 1)).toMatchObject({
      status: "succeeded",
    });
    expect((await operation(request)).idempotencyKey).toBe(stored.idempotencyKey);
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
    expect(
      (await db.select().from(refundAttempts).where(eq(refundAttempts.operationId, stored.id)))
        .map((attempt) => attempt.outcome)
        .sort(),
    ).toEqual(["retryable", "succeeded"]);
  });
  it("retains unknown amounts and items after a lost successful response", async () => {
    const first = await ready();
    const second = await ready(first.order);
    await configure(first.paymentRef, "drop_response");
    await submit(first.request);
    const stored = await operation(first.request);
    expect(await run(stored.id)).toMatchObject({ status: "unknown" });
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
    expect((await detail(first.request)).status).toBe("inspection_passed");
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, first.request.id), eq(returnUnits.active, true))),
    ).toHaveLength(1);
    expect(returnDetailContract.assert((await submit(first.request)).json()).refund?.id).toBe(
      stored.id,
    );
    expect(await run(stored.id)).toBeNull();
    await db.update(orders).set({ capturedMinor: 5000 }).where(eq(orders.id, first.order.id));
    expect((await submit(second.request)).statusCode).toBe(409);
  });
  it("holds terminal failures without creating replacement operations", async () => {
    const { request, paymentRef } = await ready();
    await configure(paymentRef, "reject");
    await submit(request);
    const stored = await operation(request);
    expect(await run(stored.id)).toMatchObject({ status: "failed" });
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(0);
    expect(returnDetailContract.assert((await submit(request)).json()).refund?.id).toBe(stored.id);
    expect(await run(stored.id)).toBeNull();
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
    ).toHaveLength(1);
  });
  it("reclaims an expired worker after provider success and fences its late completion", async () => {
    const { request } = await ready();
    await submit(request);
    const stored = await operation(request);
    const now = Date.now();
    const abandoned = await claimRefundJob(db, config.demoNow, { operationId: stored.id, now });
    if (!abandoned) throw new Error("No worker claim");
    const receipt = await provider.submit(abandoned.payload);
    expect(receipt.kind).toBe("receipt");
    expect(await run(stored.id, now + REFUND_LEASE_MS + 1)).toMatchObject({ status: "succeeded" });
    expect(
      await completeRefundJob(
        db,
        abandoned,
        { kind: "unknown", message: "Old response lost" },
        config.demoNow,
      ),
    ).toEqual({ applied: false });
    expect((await operation(request)).status).toBe("succeeded");
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
    expect(
      (await db.select().from(refundAttempts).where(eq(refundAttempts.operationId, stored.id)))
        .map((attempt) => attempt.outcome)
        .sort(),
    ).toEqual(["abandoned", "succeeded"]);
  });
  it("does not hold an order transaction across provider HTTP or allow a second live lease", async () => {
    const { request, order } = await ready();
    await submit(request);
    const stored = await operation(request);
    let entered = () => {};
    const waiting = new Promise<void>((accept) => {
      entered = accept;
    });
    let release = () => {};
    const held = new Promise<void>((accept) => {
      release = accept;
    });
    const pending = run(stored.id, undefined, {
      submit: async (payload) => {
        const result = await provider.submit(payload);
        entered();
        await held;
        return result;
      },
    });
    try {
      await Promise.race([
        waiting,
        delay(2500, undefined, { ref: false }).then(() => {
          throw new Error("Provider barrier not reached");
        }),
      ]);
      await db.transaction(async (tx) => {
        await tx.execute(sql`set local lock_timeout = '250ms'`);
        await tx.select().from(orders).where(eq(orders.id, order.id)).for("update");
      });
      expect(await claimRefundJob(db, config.demoNow, { operationId: stored.id })).toBeNull();
      release();
      expect(await pending).toMatchObject({ status: "succeeded" });
    } finally {
      release();
      await pending;
    }
  });
  it("keeps a mismatched provider receipt unknown rather than closing the return", async () => {
    const { request } = await ready();
    await submit(request);
    const stored = await operation(request);
    const mismatched: PaymentProvider = {
      submit: async (payload) => {
        const result = await provider.submit(payload);
        return result.kind === "receipt"
          ? {
              ...result,
              receipt: { ...result.receipt, amountMinor: result.receipt.amountMinor + 1 },
            }
          : result;
      },
    };
    expect(await run(stored.id, undefined, mismatched)).toMatchObject({ status: "unknown" });
    expect((await detail(request)).status).toBe("inspection_passed");
    expect(
      await db.select().from(refundReceipts).where(eq(refundReceipts.operationId, stored.id)),
    ).toHaveLength(0);
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
  });
  it("rolls back receipt, job acknowledgement, closure and consumption if the success audit fails", async () => {
    const { request, order } = await ready();
    await submit(request);
    const stored = await operation(request);
    const now = Date.now();
    const claim = await claimRefundJob(db, config.demoNow, { operationId: stored.id, now });
    if (!claim) throw new Error("No worker claim");
    const receipt = await provider.submit(claim.payload);
    await db.execute(
      sql.raw(
        `alter table audit_entries add constraint injected_success_failure check (return_id <> '${request.id}' or event <> 'Refund succeeded')`,
      ),
    );
    try {
      await expect(completeRefundJob(db, claim, receipt, config.demoNow)).rejects.toThrow();
      expect((await operation(request)).status).toBe("processing");
      expect((await detail(request)).status).toBe("inspection_passed");
      expect(
        await db.select().from(refundReceipts).where(eq(refundReceipts.operationId, stored.id)),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(orderUnits)
          .where(and(eq(orderUnits.lineId, order.lineId), eq(orderUnits.consumed, 1))),
      ).toHaveLength(0);
      const [job] = await db.select().from(refundJobs).where(eq(refundJobs.operationId, stored.id));
      expect(job).toMatchObject({ completedAt: null, leaseToken: claim.token });
    } finally {
      await db.execute(sql`alter table audit_entries drop constraint injected_success_failure`);
    }
    expect(await run(stored.id, now + REFUND_LEASE_MS + 1)).toMatchObject({ status: "succeeded" });
    expect(await ledgerFor(stored.idempotencyKey)).toHaveLength(1);
  });
});
