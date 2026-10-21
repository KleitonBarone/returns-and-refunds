import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../apps/server/src/app.ts";
import {
  createPaymentProvider,
  type PaymentProvider,
  readProviderConfig,
} from "../../apps/server/src/provider.ts";
import {
  claimRefundJob,
  completeRefundJob,
  processRefundJob,
} from "../../apps/server/src/refund-worker.ts";
import {
  memberships,
  orderUnits,
  providerEventReceipts,
  refundAttempts,
  refundJobs,
  refundOperations,
  refundReceipts,
  returnUnits,
  users,
} from "../../apps/server/src/schema.ts";
import { eventHeaders } from "../../apps/simulator/src/events.ts";
import { type ReturnView, returnDetailContract } from "../../packages/contracts/src/index.ts";
import {
  type ProviderEvent,
  type ProviderReceipt,
  simulatorDiagnostics,
} from "../../packages/contracts/src/payment.ts";
import { testContext } from "./helpers.ts";

const realProvider = createPaymentProvider();
let lookupOverride: PaymentProvider["lookup"] | undefined;
let lookupCalls = 0;
const provider: PaymentProvider = {
  ...realProvider,
  lookup: async (payload) => {
    lookupCalls++;
    return lookupOverride ? lookupOverride(payload) : realProvider.lookup(payload);
  },
};
const context = await testContext({ provider });
const { app, db, pool, fixture, input, login, config } = context;
const providerConfig = readProviderConfig();
const signingSecret = String(process.env.SIMULATOR_SIGNING_SECRET);
afterAll(context.close);
afterEach(() => {
  lookupOverride = undefined;
  lookupCalls = 0;
});

async function control(path: string, body?: unknown) {
  const response = await fetch(`${providerConfig.url}/control/${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      authorization: `Bearer ${process.env.SIMULATOR_ADMIN_TOKEN}`,
      "content-type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(3000),
  });
  expect(response.ok).toBe(true);
  const result: unknown = await response.json();
  return result;
}
async function ready(mode: "success" | "drop_response" | "reject" = "drop_response") {
  const order = await fixture();
  const paymentRef = `payment-${order.id}`;
  await control("captures", {
    merchantId: "northline",
    paymentRef,
    capturedMinor: 10001,
    currency: "USD",
  });
  await control("payments", {
    merchantId: "northline",
    paymentRef,
    mode,
    responseDelayMs: 0,
    eventDelayMs: 0,
    eventCopies: 1,
  });
  const created = await app.inject({
    method: "POST",
    url: "/api/returns",
    headers: await login("customer-maya"),
    payload: input(order),
  });
  expect(created.statusCode).toBe(201);
  const request = returnDetailContract.assert(created.json());
  for (const [action, expectedStatus, persona] of [
    ["approve", "requested", "support-ava"],
    ["receive", "approved", "warehouse-jules"],
    ["pass_inspection", "received", "warehouse-jules"],
  ] as const) {
    expect(
      (
        await app.inject({
          method: "POST",
          url: `/api/returns/${request.id}/actions`,
          headers: await login(persona),
          payload: {
            action,
            expectedStatus,
            reason: "Verified for recovery",
            correlationId: randomUUID(),
          },
        })
      ).statusCode,
    ).toBe(200);
  }
  expect(
    (
      await app.inject({
        method: "POST",
        url: `/api/returns/${request.id}/refund`,
        headers: await login("finance-sam"),
        payload: {
          expectedAmountMinor: request.amountMinor,
          reason: "Refund inspected item",
          correlationId: randomUUID(),
        },
      })
    ).statusCode,
  ).toBe(202);
  const [operation] = await db
    .select()
    .from(refundOperations)
    .where(eq(refundOperations.returnId, request.id));
  if (!operation) throw new Error("Refund operation missing");
  return { request, order, operation };
}
async function run(operationId: string) {
  return processRefundJob(db, provider, config.demoNow, { operationId });
}
async function recover(
  request: ReturnView,
  action: "check" | "retry" = "check",
  persona = "finance-sam",
) {
  return app.inject({
    method: "POST",
    url: `/api/returns/${request.id}/refund/${action}`,
    headers: await login(persona),
    payload: { reason: "Verify and recover the original payment", correlationId: randomUUID() },
  });
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
async function receiptFor(key: string) {
  const diagnostics = simulatorDiagnostics.assert(await control("diagnostics"));
  const receipt = diagnostics.refunds.find((refund) => refund.idempotencyKey === key);
  if (!receipt) throw new Error("Provider receipt missing");
  return receipt;
}
async function ledgerCount(receipt: ProviderReceipt) {
  const diagnostics = simulatorDiagnostics.assert(await control("diagnostics"));
  return diagnostics.ledger.filter((entry) => entry.refundId === receipt.id).length;
}
function eventFor(receipt: ProviderReceipt, status = receipt.status): ProviderEvent {
  return {
    id: randomUUID(),
    provider: "local-simulator",
    occurredAt: config.demoNow,
    refund: { ...receipt, status },
  };
}
async function deliver(
  event: ProviderEvent,
  extra: { raw?: string; timestamp?: number; signature?: string } = {},
) {
  const raw = extra.raw ?? JSON.stringify(event);
  const headers = eventHeaders(raw, signingSecret, extra.timestamp);
  if (extra.signature !== undefined) headers["x-simulator-signature"] = extra.signature;
  return app.inject({ method: "POST", url: "/api/provider-events", headers, payload: raw });
}

describe("refund recovery and signed payment events", () => {
  it("recovers a lost response by original-key lookup without another submission", async () => {
    const { request, operation } = await ready();
    expect(await run(operation.id)).toMatchObject({ status: "unknown" });
    const receipt = await receiptFor(operation.idempotencyKey);
    const result = await recover(request);
    expect(result.statusCode).toBe(202);
    expect(returnDetailContract.assert(result.json())).toMatchObject({
      status: "closed",
      refund: {
        id: operation.id,
        status: "succeeded",
        lastLookup: "found",
        providerReceiptId: receipt.id,
      },
    });
    expect(await ledgerCount(receipt)).toBe(1);
    expect(
      (await detail(request)).history.filter((entry) => entry.event === "Refund succeeded"),
    ).toHaveLength(1);
    expect(
      await db.select().from(refundAttempts).where(eq(refundAttempts.operationId, operation.id)),
    ).toHaveLength(1);
  });
  it("keeps unavailable and mismatched lookup outcomes unknown and reserved", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    lookupOverride = async () => ({
      kind: "unavailable",
      message: "Provider temporarily unavailable",
    });
    expect(returnDetailContract.assert((await recover(request)).json()).refund).toMatchObject({
      status: "unknown",
      lastLookup: "unavailable",
    });
    const receipt = await receiptFor(operation.idempotencyKey);
    lookupOverride = async () => ({ kind: "receipt", receipt: { ...receipt, currency: "EUR" } });
    expect(returnDetailContract.assert((await recover(request)).json()).refund).toMatchObject({
      status: "unknown",
      lastLookup: "unavailable",
    });
    expect((await recover(request, "retry")).statusCode).toBe(409);
    expect(
      await db
        .select()
        .from(returnUnits)
        .where(and(eq(returnUnits.returnId, request.id), eq(returnUnits.active, true))),
    ).toHaveLength(1);
    expect(
      await db.select().from(refundReceipts).where(eq(refundReceipts.operationId, operation.id)),
    ).toHaveLength(0);
    expect(await ledgerCount(receipt)).toBe(1);
  });
  it("permits only finance in the owning merchant to check or retry", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const outsider = `finance-${randomUUID()}`;
    await db.insert(users).values({ id: outsider, name: "Other merchant finance" });
    await db
      .insert(memberships)
      .values({ merchantId: "other-store", userId: outsider, role: "finance" });
    for (const action of ["check", "retry"] as const) {
      for (const persona of ["customer-maya", "support-ava", "warehouse-jules"])
        expect((await recover(request, action, persona)).statusCode).toBe(403);
      expect((await recover(request, action, outsider)).statusCode).toBe(404);
    }
    expect(lookupCalls).toBe(0);
  });
  it("requeues only a verified missing refund with the same operation and key", async () => {
    const { request, operation } = await ready("success");
    const claim = await claimRefundJob(db, config.demoNow, { operationId: operation.id });
    if (!claim) throw new Error("No claim");
    await completeRefundJob(
      db,
      claim,
      { kind: "unknown", message: "Disconnected before request reached provider" },
      config.demoNow,
    );
    expect((await recover(request, "retry")).statusCode).toBe(409);
    expect(returnDetailContract.assert((await recover(request)).json()).refund).toMatchObject({
      status: "unknown",
      lastLookup: "not_found",
    });
    const retried = await Promise.all([recover(request, "retry"), recover(request, "retry")]);
    expect(retried.map((response) => response.statusCode)).toEqual([202, 202]);
    expect(await run(operation.id)).toMatchObject({ status: "succeeded" });
    const result = await detail(request);
    expect(result.refund?.id).toBe(operation.id);
    expect(result.history.filter((event) => event.event === "Refund retry requested")).toHaveLength(
      1,
    );
    expect(await ledgerCount(await receiptFor(operation.idempotencyKey))).toBe(1);
    expect(
      await db.select().from(refundJobs).where(eq(refundJobs.operationId, operation.id)),
    ).toHaveLength(1);
  });
  it("does not resubmit a terminal rejection", async () => {
    const { request, operation } = await ready("reject");
    await run(operation.id);
    expect((await recover(request, "retry")).statusCode).toBe(409);
    expect(returnDetailContract.assert((await recover(request)).json()).refund?.status).toBe(
      "failed",
    );
    expect(lookupCalls).toBe(0);
    expect(await ledgerCount(await receiptFor(operation.idempotencyKey))).toBe(0);
  });
  it("confirms a contradictory success event against a rejected provider refund", async () => {
    const { request, operation } = await ready("reject");
    await run(operation.id);
    const receipt = await receiptFor(operation.idempotencyKey);
    expect((await deliver(eventFor(receipt, "succeeded"))).statusCode).toBe(200);
    expect(lookupCalls).toBe(1);
    expect((await detail(request)).refund?.status).toBe("failed");
    expect((await detail(request)).status).toBe("inspection_passed");
    expect(await ledgerCount(receipt)).toBe(0);
  });
  it("rolls back financial success when the finance check audit cannot commit", async () => {
    const { request, order, operation } = await ready();
    await run(operation.id);
    await db.execute(
      sql.raw(
        `alter table audit_entries add constraint injected_check_failure check (return_id <> '${request.id}' or event <> 'Refund status checked')`,
      ),
    );
    try {
      expect((await recover(request)).statusCode).toBe(500);
      expect((await detail(request)).refund).toMatchObject({ status: "unknown", lastLookup: null });
      expect(
        (await detail(request)).history.filter((entry) => entry.event === "Refund succeeded"),
      ).toHaveLength(0);
      expect(
        await db
          .select()
          .from(orderUnits)
          .where(and(eq(orderUnits.lineId, order.lineId), eq(orderUnits.consumed, 1))),
      ).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table audit_entries drop constraint injected_check_failure`);
    }
    expect((await recover(request)).statusCode).toBe(202);
    expect(await ledgerCount(await receiptFor(operation.idempotencyKey))).toBe(1);
  });
  it("checks raw bytes, delivery timestamps, signatures and event shape before writes", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const event = eventFor(await receiptFor(operation.idempotencyKey));
    for (const options of [
      { signature: "0".repeat(64) },
      { signature: "bad" },
      { timestamp: Date.now() - 301000 },
      { timestamp: Date.now() + 301000 },
    ])
      expect((await deliver(event, options)).statusCode).toBe(401);
    const raw = JSON.stringify(event);
    expect(
      (
        await app.inject({
          method: "POST",
          url: "/api/provider-events",
          headers: eventHeaders(raw, signingSecret),
          payload: `${raw} `,
        })
      ).statusCode,
    ).toBe(401);
    expect((await deliver(event, { raw: "{" })).statusCode).toBe(400);
    expect(
      (await deliver(event, { raw: JSON.stringify({ ...event, provider: "another-provider" }) }))
        .statusCode,
    ).toBe(422);
    expect(
      await db
        .select()
        .from(providerEventReceipts)
        .where(eq(providerEventReceipts.operationId, operation.id)),
    ).toHaveLength(0);
    expect((await detail(request)).refund?.status).toBe("unknown");
    const pretty = await deliver(event, { raw: JSON.stringify(event, null, 2) });
    expect(pretty.statusCode).toBe(200);
  });
  it("rejects validly signed events with the wrong merchant, key, amount, currency or receipt", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const event = eventFor(await receiptFor(operation.idempotencyKey));
    for (const changed of [
      { merchantId: "other-store" },
      { idempotencyKey: `return-refund-${randomUUID()}` },
      { amountMinor: 1 },
      { currency: "EUR" },
      { id: randomUUID() },
    ]) {
      expect(
        (await deliver({ ...event, refund: { ...event.refund, ...changed } })).statusCode,
      ).toBe(422);
    }
    expect((await detail(request)).refund?.status).toBe("unknown");
    expect(
      await db
        .select()
        .from(providerEventReceipts)
        .where(eq(providerEventReceipts.operationId, operation.id)),
    ).toHaveLength(0);
  });
  it("commits one event receipt and financial effect for competing duplicate deliveries", async () => {
    const { request, order, operation } = await ready();
    await run(operation.id);
    const receipt = await receiptFor(operation.idempotencyKey);
    const event = eventFor(receipt);
    const responses = await Promise.all([deliver(event), deliver(event)]);
    expect(responses.map((response) => response.statusCode)).toEqual([200, 200]);
    expect(responses.map((response) => response.json().duplicate).sort()).toEqual([false, true]);
    expect(
      await db
        .select()
        .from(providerEventReceipts)
        .where(eq(providerEventReceipts.operationId, operation.id)),
    ).toHaveLength(1);
    expect(
      (await detail(request)).history.filter((entry) => entry.event === "Refund succeeded"),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(orderUnits)
        .where(and(eq(orderUnits.lineId, order.lineId), eq(orderUnits.consumed, 1))),
    ).toHaveLength(1);
    expect(await ledgerCount(receipt)).toBe(1);
    expect((await deliver({ ...event, refund: { ...receipt, status: "failed" } })).statusCode).toBe(
      409,
    );
  });
  it("never regresses success for delayed processing or contradictory terminal events", async () => {
    const { request, operation } = await ready("success");
    await run(operation.id);
    const receipt = await receiptFor(operation.idempotencyKey);
    expect((await deliver(eventFor(receipt, "processing"))).statusCode).toBe(200);
    expect(lookupCalls).toBe(0);
    expect((await deliver(eventFor(receipt, "failed"))).statusCode).toBe(200);
    expect(lookupCalls).toBe(1);
    const result = await detail(request);
    expect(result.refund?.status).toBe("succeeded");
    expect(result.status).toBe("closed");
    expect(result.history.filter((entry) => entry.event === "Refund succeeded")).toHaveLength(1);
    const events = await db
      .select()
      .from(providerEventReceipts)
      .where(eq(providerEventReceipts.operationId, operation.id));
    expect(events.map((entry) => entry.outcome).sort()).toEqual(["ignored", "reconciled"]);
    expect(await ledgerCount(receipt)).toBe(1);
  });
  it("rolls back event receipt and all success effects when audit storage rejects the write", async () => {
    const { request, order, operation } = await ready("success");
    const claim = await claimRefundJob(db, config.demoNow, { operationId: operation.id });
    if (!claim) throw new Error("No claim");
    const result = await provider.submit(claim.payload);
    if (result.kind !== "receipt") throw new Error("No receipt");
    const event = eventFor(result.receipt);
    await db.execute(
      sql.raw(
        `alter table audit_entries add constraint injected_event_audit_failure check (return_id <> '${request.id}' or event <> 'Refund succeeded')`,
      ),
    );
    try {
      expect((await deliver(event)).statusCode).toBe(500);
      expect(
        await db
          .select()
          .from(providerEventReceipts)
          .where(eq(providerEventReceipts.operationId, operation.id)),
      ).toHaveLength(0);
      expect(
        await db.select().from(refundReceipts).where(eq(refundReceipts.operationId, operation.id)),
      ).toHaveLength(0);
      expect((await detail(request)).refund?.status).toBe("processing");
      expect(
        (await db.select().from(refundJobs).where(eq(refundJobs.operationId, operation.id)))[0],
      ).toMatchObject({ leaseToken: claim.token, completedAt: null });
      expect(
        (
          await db.select().from(refundAttempts).where(eq(refundAttempts.operationId, operation.id))
        )[0]?.outcome,
      ).toBe("started");
      expect(
        await db
          .select()
          .from(orderUnits)
          .where(and(eq(orderUnits.lineId, order.lineId), eq(orderUnits.consumed, 1))),
      ).toHaveLength(0);
    } finally {
      await db.execute(sql`alter table audit_entries drop constraint injected_event_audit_failure`);
    }
    expect((await deliver(event)).statusCode).toBe(200);
    expect((await detail(request)).status).toBe("closed");
  });
  it("lets an event win an in-flight worker without its later response overwriting success", async () => {
    const { request, operation } = await ready("success");
    const claim = await claimRefundJob(db, config.demoNow, { operationId: operation.id });
    if (!claim) throw new Error("No claim");
    const submitted = await provider.submit(claim.payload);
    if (submitted.kind !== "receipt") throw new Error("Receipt missing");
    expect((await deliver(eventFor(submitted.receipt))).statusCode).toBe(200);
    expect(
      await completeRefundJob(
        db,
        claim,
        { kind: "unknown", message: "Late timeout" },
        config.demoNow,
      ),
    ).toEqual({ applied: false });
    expect((await detail(request)).refund?.status).toBe("succeeded");
    expect(
      (
        await db.select().from(refundAttempts).where(eq(refundAttempts.operationId, operation.id))
      )[0]?.outcome,
    ).toBe("fenced");
    expect(await ledgerCount(submitted.receipt)).toBe(1);
  });
  it("serializes finance status checks and an event without duplicate closure or audit", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const receipt = await receiptFor(operation.idempotencyKey);
    const results = await Promise.all([
      recover(request),
      recover(request),
      deliver(eventFor(receipt)),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([200, 202, 202]);
    const result = await detail(request);
    expect(result.refund?.id).toBe(operation.id);
    expect(result.history.filter((entry) => entry.event === "Refund succeeded")).toHaveLength(1);
    expect(await ledgerCount(receipt)).toBe(1);
  });
  it("retains uncertain state and no event receipt while terminal lookup is unavailable", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const event = eventFor(await receiptFor(operation.idempotencyKey));
    lookupOverride = async () => ({ kind: "unavailable", message: "Disconnected" });
    expect((await deliver(event)).statusCode).toBe(503);
    expect((await detail(request)).refund?.status).toBe("unknown");
    expect(
      await db
        .select()
        .from(providerEventReceipts)
        .where(eq(providerEventReceipts.operationId, operation.id)),
    ).toHaveLength(0);
    lookupOverride = undefined;
    expect((await deliver(event)).statusCode).toBe(200);
  });
  it("holds no order transaction across the recovery lookup", async () => {
    const { request, order, operation } = await ready();
    await run(operation.id);
    let entered = () => {};
    const waiting = new Promise<void>((accept) => {
      entered = accept;
    });
    let release = () => {};
    const held = new Promise<void>((accept) => {
      release = accept;
    });
    lookupOverride = async (payload) => {
      entered();
      await held;
      return realProvider.lookup(payload);
    };
    const pending = recover(request);
    try {
      await Promise.race([
        waiting,
        delay(2500, undefined, { ref: false }).then(() => {
          throw new Error("Lookup barrier missing");
        }),
      ]);
      const connection = await pool.connect();
      try {
        await connection.query("begin");
        await connection.query("set local lock_timeout = '250ms'");
        await connection.query("select id from orders where id=$1 for update", [order.id]);
        await connection.query("rollback");
      } finally {
        connection.release();
      }
      release();
      expect((await pending).statusCode).toBe(202);
    } finally {
      release();
      await pending;
    }
  });
  it("accepts real signed duplicate deliveries from the simulator HTTP service", async () => {
    const { request, operation } = await ready();
    await run(operation.id);
    const receipt = await receiptFor(operation.idempotencyKey);
    await control("events", { refundId: receipt.id, status: "succeeded", delayMs: 0, copies: 2 });
    const receiver = await createApp(db, config, { provider });
    await receiver.listen({ port: config.port, host: "127.0.0.1" });
    try {
      await control("deliver", { refundId: receipt.id });
      expect((await detail(request)).refund?.status).toBe("succeeded");
      expect(
        (await detail(request)).history.filter((entry) => entry.event === "Refund succeeded"),
      ).toHaveLength(1);
      const diagnostics = simulatorDiagnostics.assert(await control("diagnostics"));
      const deliveries = diagnostics.deliveries.filter(
        (delivery) => delivery.refundId === receipt.id,
      );
      expect(deliveries).toHaveLength(4);
      expect(
        deliveries.every((delivery) => delivery.deliveredAt && delivery.lastStatus === 200),
      ).toBe(true);
      expect(await ledgerCount(receipt)).toBe(1);
    } finally {
      await receiver.close();
    }
  });
});
