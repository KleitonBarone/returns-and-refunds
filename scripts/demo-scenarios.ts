import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { type } from "arktype";
import { eq } from "drizzle-orm";
import { connectDatabase } from "../apps/server/src/db.ts";
import { createPaymentProvider, readProviderConfig } from "../apps/server/src/provider.ts";
import { processRefundJob } from "../apps/server/src/refund-worker.ts";
import {
  orderLines,
  orders,
  orderUnits,
  providerEventReceipts,
  refundAttempts,
  refundOperations,
} from "../apps/server/src/schema.ts";
import { connectSimulator } from "../apps/simulator/src/db.ts";
import {
  DEMO_NOW,
  ordersContract,
  type ReturnView,
  returnDetailContract,
} from "../packages/contracts/src/index.ts";
import { controlInput, simulatorDiagnostics } from "../packages/contracts/src/payment.ts";
import { type Manifest, restartApi, restartRefundWorker, restartSimulator } from "./environment.ts";

export function demoClient(env: NodeJS.ProcessEnv, manifest: Manifest) {
  const api = `http://127.0.0.1:${manifest.apiPort}/api`;
  const origin = `http://127.0.0.1:${manifest.webPort}`;
  const sessions = new Map<string, string>();
  async function request(path: string, persona: string, body?: unknown, expected = 200) {
    let cookie = sessions.get(persona);
    if (!cookie) {
      const response = await fetch(`${api}/session`, {
        method: "POST",
        headers: { origin, "content-type": "application/json" },
        body: JSON.stringify({ personaId: persona }),
        signal: AbortSignal.timeout(3000),
      });
      assert.equal(response.status, 200, "Demo persona login failed");
      cookie = response.headers.getSetCookie()[0]?.split(";")[0];
      assert.ok(cookie);
      sessions.set(persona, cookie);
    }
    const response = await fetch(`${api}/${path}`, {
      method: body ? "POST" : "GET",
      headers: { origin, cookie, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    const result: unknown = await response.json();
    assert.equal(
      response.status,
      expected,
      `Demo ${path} expected ${expected}, received ${response.status}: ${JSON.stringify(result)}`,
    );
    return result;
  }
  async function detail(id: string) {
    return returnDetailContract.assert(await request(`returns/${id}`, "finance-sam"));
  }
  async function control(path: string, body?: unknown) {
    const response = await fetch(`${env.SIMULATOR_URL}/control/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${env.SIMULATOR_ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(5000),
    });
    assert.ok(response.ok, `Simulator control ${path} failed with ${response.status}`);
    const result: unknown = await response.json();
    return result;
  }
  return { request, detail, control };
}

// These fixtures add orders and captures; every return, decision, and refund uses the real HTTP API.
export async function seedDemoScenarios(env: NodeJS.ProcessEnv, manifest: Manifest) {
  const { db, pool } = connectDatabase(String(env.DATABASE_URL));
  const client = demoClient(env, manifest);
  const provider = createPaymentProvider(readProviderConfig(env));
  try {
    for (const name of ["normal", "inspection", "retryable", "unknown"]) {
      const id = `demo-${name}`;
      await db.transaction(async (tx) => {
        await tx.insert(orders).values({
          id,
          number: `DEMO-${name.toUpperCase()}`,
          merchantId: "northline",
          customerId: "customer-maya",
          paymentRef: `payment-${id}`,
          capturedMinor: 7000,
          deliveredAt: "2026-09-22T12:00:00.000Z",
        });
        await tx.insert(orderLines).values({
          id: `${id}-tee`,
          orderId: id,
          name: "Heavyweight cotton tee",
          variant: "Washed indigo / M",
          quantity: 2,
          netMinor: 7000,
        });
        await tx.insert(orderUnits).values(
          [1, 2].map((position) => ({
            id: `${id}-tee:${position}`,
            lineId: `${id}-tee`,
            position,
            netMinor: 3500,
          })),
        );
      });
      await client.control("captures", {
        merchantId: "northline",
        paymentRef: `payment-${id}`,
        capturedMinor: 7000,
        currency: "USD",
      });
    }
    async function request(orderId: string, persona = "customer-maya", quantity = 1) {
      return returnDetailContract.assert(
        await client.request(
          "returns",
          persona,
          {
            orderId,
            requestKey: randomUUID(),
            reason: "The tee fits larger than expected.",
            items: [{ lineId: `${orderId}-tee`, quantity }],
          },
          201,
        ),
      );
    }
    async function inspect(request: ReturnView, pass: boolean) {
      for (const [action, expectedStatus, persona] of [
        ["approve", "requested", "support-ava"],
        ["receive", "approved", "warehouse-jules"],
        [pass ? "pass_inspection" : "fail_inspection", "received", "warehouse-jules"],
      ] as const) {
        await client.request(`returns/${request.id}/actions`, persona, {
          action,
          expectedStatus,
          reason: pass
            ? "Eligible item received in original condition."
            : "The item arrived damaged beyond the return policy.",
          correlationId: randomUUID(),
        });
      }
      return client.detail(request.id);
    }
    const inspection = await inspect(await request("demo-inspection"), false);
    assert.equal(inspection.closureReason, "inspection_failed");
    assert.equal(inspection.refund, null);
    const results = [];
    for (const [name, mode] of [
      ["normal", "success"],
      ["retryable", "retry_once"],
      ["unknown", "drop_response"],
    ] as const) {
      const inspected = await inspect(await request(`demo-${name}`), true);
      await client.control(
        "payments",
        controlInput.assert({
          merchantId: "northline",
          paymentRef: `payment-demo-${name}`,
          mode,
          responseDelayMs: 0,
          eventDelayMs: 60000,
          eventCopies: 1,
        }),
      );
      const submitted = returnDetailContract.assert(
        await client.request(
          `returns/${inspected.id}/refund`,
          "finance-sam",
          {
            expectedAmountMinor: 3500,
            reason: "Refund the inspected tee only.",
            correlationId: randomUUID(),
          },
          202,
        ),
      );
      assert.ok(submitted.refund);
      const operationId = submitted.refund.id;
      const now = Date.now();
      await processRefundJob(db, provider, DEMO_NOW, { operationId, now });
      if (name === "retryable") {
        const attempts = await db
          .select()
          .from(refundAttempts)
          .where(eq(refundAttempts.operationId, operationId));
        assert.deepEqual(
          attempts.map((attempt) => attempt.outcome),
          ["retryable"],
        );
        const before = simulatorDiagnostics.assert(await client.control("diagnostics"));
        assert.equal(
          before.ledger.filter((entry) => entry.paymentRef === "payment-demo-retryable").length,
          0,
        );
        // Advance the worker's scheduling clock to the recorded retry deadline.
        assert.ok(await processRefundJob(db, provider, DEMO_NOW, { operationId, now: now + 1000 }));
      }
      const detail = await client.detail(inspected.id);
      assert.equal(detail.refund?.status, name === "unknown" ? "unknown" : "succeeded");
      const [operation] = await db
        .select()
        .from(refundOperations)
        .where(eq(refundOperations.id, operationId));
      assert.ok(operation);
      const diagnostics = simulatorDiagnostics.assert(await client.control("diagnostics"));
      const receipt = diagnostics.refunds.find(
        (entry) => entry.idempotencyKey === operation.idempotencyKey,
      );
      assert.ok(receipt);
      const ledger = diagnostics.ledger.filter((entry) => entry.refundId === receipt.id);
      assert.equal(ledger.length, 1);
      assert.equal(ledger[0]?.amountMinor, 3500);
      const attempts = await db
        .select()
        .from(refundAttempts)
        .where(eq(refundAttempts.operationId, operationId));
      results.push({
        scenario: name,
        returnId: detail.id,
        operationId,
        providerId: receipt.id,
        appStatus: detail.refund?.status,
        appAmountMinor: detail.amountMinor,
        currency: detail.currency,
        ledgerEntries: ledger.length,
        ledgerAmountMinor: ledger[0]?.amountMinor,
        attempts: attempts.map((entry) => entry.outcome).sort(),
      });
    }
    await client.request(
      "returns",
      "customer-maya",
      {
        orderId: "demo-normal",
        requestKey: randomUUID(),
        reason: "Try to return a consumed unit again.",
        items: [{ lineId: "demo-normal-tee", quantity: 2 }],
      },
      409,
    );
    await client.request(
      "returns",
      "customer-maya",
      {
        orderId: "order-1031",
        requestKey: randomUUID(),
        reason: "This delivered order is outside the window.",
        items: [{ lineId: "order-1031-tee", quantity: 1 }],
      },
      422,
    );
    const other = await request("order-other", "customer-other");
    await client.request(`returns/${other.id}`, "support-ava", undefined, 404);
    assert.equal(
      returnDetailContract.assert(await client.request(`returns/${other.id}`, "support-other")).id,
      other.id,
    );
    const customerOrders = ordersContract.assert(await client.request("orders", "customer-maya"));
    assert.equal(
      customerOrders.find((order) => order.id === "demo-normal")?.lines[0]?.available,
      1,
    );
    assert.equal(
      customerOrders.find((order) => order.id === "demo-inspection")?.lines[0]?.available,
      2,
    );
    assert.equal(
      customerOrders.find((order) => order.id === "demo-unknown")?.lines[0]?.available,
      1,
    );
    const normalUnits = await db
      .select()
      .from(orderUnits)
      .where(eq(orderUnits.lineId, "demo-normal-tee"));
    const unknownUnits = await db
      .select()
      .from(orderUnits)
      .where(eq(orderUnits.lineId, "demo-unknown-tee"));
    assert.equal(normalUnits.filter((unit) => unit.consumed === 1).length, 1);
    assert.equal(unknownUnits.filter((unit) => unit.consumed === 1).length, 0);
    const ledger = simulatorDiagnostics.assert(await client.control("diagnostics")).ledger;
    const ledgerAmountMinor = ledger.reduce((sum, entry) => sum + entry.amountMinor, 0);
    assert.equal(ledger.length, 3);
    assert.equal(ledgerAmountMinor, 10500);
    return {
      clock: DEMO_NOW,
      refunds: results,
      inspection: {
        returnId: inspection.id,
        status: inspection.status,
        closureReason: inspection.closureReason,
        refund: null,
      },
      expiredHttpStatus: 422,
      consumedUnitHttpStatus: 409,
      remainingNormalUnits: 1,
      releasedInspectionUnits: 2,
      otherMerchant: { returnId: other.id, status: other.status, crossMerchantHttpStatus: 404 },
      ledgerEntries: ledger.length,
      ledgerAmountMinor,
      confirmedAppAmountMinor: 7000,
      unknownReservedMinor: 3500,
    };
  } finally {
    await pool.end();
  }
}

export type DemoEvidence = Awaited<ReturnType<typeof seedDemoScenarios>>;

export async function recoverDemo(
  env: NodeJS.ProcessEnv,
  manifest: Manifest,
  evidence: DemoEvidence,
) {
  const unknown = evidence.refunds.find((result) => result.scenario === "unknown");
  assert.ok(unknown);
  const client = demoClient(env, manifest);
  const before = simulatorDiagnostics.assert(await client.control("diagnostics"));
  const simulator = connectSimulator(String(env.SIMULATOR_DATABASE_URL));
  try {
    // Hold original deliveries behind a fixture barrier, independent of machine speed.
    await simulator.pool.query(
      "update deliveries set run_at = '2100-01-01T00:00:00Z' where delivered_at is null",
    );
  } finally {
    await simulator.pool.end();
  }
  await restartApi(manifest, env);
  await restartRefundWorker(manifest, env);
  await restartSimulator(manifest, env);
  const checked = returnDetailContract.assert(
    await client.request(
      `returns/${unknown.returnId}/refund/check`,
      "finance-sam",
      {
        reason: "Recover the same refund after restarting every service.",
        correlationId: randomUUID(),
      },
      202,
    ),
  );
  assert.equal(checked.refund?.id, unknown.operationId);
  assert.equal(checked.refund?.status, "succeeded");
  assert.equal(checked.refund.providerReceiptId, unknown.providerId);
  const event = type({ eventId: "string.uuid" }).assert(
    await client.control("events", {
      refundId: unknown.providerId,
      status: "processing",
      delayMs: 0,
      copies: 3,
    }),
  );
  await client.control("deliver", { refundId: unknown.providerId });
  const after = simulatorDiagnostics.assert(await client.control("diagnostics"));
  assert.deepEqual(
    after.ledger,
    before.ledger,
    "Restart and replay must preserve the independent ledger exactly",
  );
  const deliveries = after.deliveries.filter(
    (entry) => entry.refundId === unknown.providerId && entry.deliveredAt,
  );
  assert.equal(deliveries.length, 3);
  assert.ok(deliveries.every((entry) => entry.lastStatus === 200));
  const detail = await client.detail(unknown.returnId);
  assert.equal(detail.history.filter((entry) => entry.event === "Refund succeeded").length, 1);
  const { db, pool } = connectDatabase(String(env.DATABASE_URL));
  try {
    const receipts = await db
      .select()
      .from(providerEventReceipts)
      .where(eq(providerEventReceipts.operationId, unknown.operationId));
    assert.equal(receipts.length, 1);
    assert.equal(receipts[0]?.outcome, "ignored");
    const attempts = await db
      .select()
      .from(refundAttempts)
      .where(eq(refundAttempts.operationId, unknown.operationId));
    assert.equal(attempts.length, 1);
    const operations = await db.select().from(refundOperations);
    const confirmedAppAmountMinor = operations
      .filter((operation) => operation.status === "succeeded")
      .reduce((sum, operation) => sum + operation.amountMinor, 0);
    assert.equal(confirmedAppAmountMinor, 10500);
    return {
      returnId: detail.id,
      operationId: detail.refund?.id,
      providerId: detail.refund?.providerReceiptId,
      status: detail.refund?.status,
      event,
      deliveryStatuses: deliveries.map((entry) => entry.lastStatus),
      receiptOutcomes: receipts.map((entry) => entry.outcome),
      successAuditEntries: 1,
      submissionAttempts: attempts.length,
      ledgerPreserved: true,
      confirmedAppAmountMinor,
    };
  } finally {
    await pool.end();
  }
}
