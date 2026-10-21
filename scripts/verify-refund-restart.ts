import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { eq } from "drizzle-orm";
import type { Database } from "../apps/server/src/db.ts";
import { refundAttempts, refundJobs, refundOperations } from "../apps/server/src/schema.ts";
import { returnDetailContract } from "../packages/contracts/src/index.ts";
import { simulatorDiagnostics } from "../packages/contracts/src/payment.ts";
import {
  crashRefundWorker,
  type manifestType,
  restartApi,
  restartRefundWorker,
  restartSimulator,
} from "./environment.ts";

async function until(check: () => Promise<boolean>, message: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await delay(50);
  }
  throw new Error(message);
}

// Crash only this disposable run after the independent ledger commits, before acknowledgement.
export async function verifyRefundRestart(
  db: Database,
  env: NodeJS.ProcessEnv,
  manifest: typeof manifestType.infer,
) {
  const apiUrl = `http://127.0.0.1:${manifest.apiPort}`;
  const origin = `http://127.0.0.1:${manifest.webPort}`;
  async function control(path: string, body?: unknown) {
    const response = await fetch(`${env.SIMULATOR_URL}/control/${path}`, {
      method: body ? "POST" : "GET",
      headers: {
        authorization: `Bearer ${env.SIMULATOR_ADMIN_TOKEN}`,
        "content-type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(3000),
    });
    assert.ok(response.ok, `Control failed: ${response.status}`);
    const result: unknown = await response.json();
    return result;
  }
  async function session(personaId: string) {
    const response = await fetch(`${apiUrl}/api/session`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ personaId }),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, 200);
    const cookie = response.headers.getSetCookie()[0]?.split(";")[0];
    assert.ok(cookie, "Session cookie is required");
    return { origin, cookie, "content-type": "application/json" };
  }
  async function post(path: string, personaId: string, body: unknown, expected = 200) {
    const response = await fetch(`${apiUrl}/api/${path}`, {
      method: "POST",
      headers: await session(personaId),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(3000),
    });
    assert.equal(response.status, expected);
    return returnDetailContract.assert(await response.json());
  }
  async function inspectedRequest() {
    const request = await post(
      "returns",
      "customer-maya",
      {
        orderId: "order-1042",
        requestKey: randomUUID(),
        reason: "Verify recovery after worker termination",
        items: [{ lineId: "order-1042-tee", quantity: 1 }],
      },
      201,
    );
    for (const [action, expectedStatus, persona] of [
      ["approve", "requested", "support-ava"],
      ["receive", "approved", "warehouse-jules"],
      ["pass_inspection", "received", "warehouse-jules"],
    ] as const) {
      await post(`returns/${request.id}/actions`, persona, {
        action,
        expectedStatus,
        reason: "Verified for restart scenario",
        correlationId: randomUUID(),
      });
    }
    return request;
  }
  const request = await inspectedRequest();
  await control("payments", {
    merchantId: "northline",
    paymentRef: "payment-order-1042",
    mode: "delay_response",
    responseDelayMs: 5000,
    eventDelayMs: 0,
    eventCopies: 1,
  });
  const submitted = await post(
    `returns/${request.id}/refund`,
    "finance-sam",
    {
      expectedAmountMinor: 3500,
      reason: "Verify the original refund survives a worker crash",
      correlationId: randomUUID(),
    },
    202,
  );
  assert.ok(submitted.refund);
  const operationId = submitted.refund.id;
  const [operation] = await db
    .select()
    .from(refundOperations)
    .where(eq(refundOperations.id, operationId));
  assert.ok(operation);
  let providerId: string | undefined;
  await until(async () => {
    const diagnostics = simulatorDiagnostics.assert(await control("diagnostics"));
    providerId = diagnostics.refunds.find(
      (refund) => refund.idempotencyKey === operation.idempotencyKey,
    )?.id;
    return diagnostics.ledger.some((entry) => entry.refundId === providerId);
  }, "Provider write barrier was not reached");
  await crashRefundWorker(manifest);
  const [interrupted] = await db
    .select()
    .from(refundOperations)
    .where(eq(refundOperations.id, operationId));
  assert.equal(
    interrupted?.status,
    "processing",
    "worker must die before acknowledging the provider write",
  );
  await control("payments", {
    merchantId: "northline",
    paymentRef: "payment-order-1042",
    mode: "success",
    responseDelayMs: 0,
    eventDelayMs: 0,
    eventCopies: 1,
  });
  // Advance only the disposable fixture's lease instead of sleeping for its timeout.
  await db
    .update(refundJobs)
    .set({ leaseUntil: new Date(Date.now() - 1).toISOString() })
    .where(eq(refundJobs.operationId, operationId));
  await restartRefundWorker(manifest, env);
  await until(async () => {
    const [result] = await db
      .select()
      .from(refundOperations)
      .where(eq(refundOperations.id, operationId));
    return result?.status === "succeeded";
  }, "Restarted worker did not recover the original refund");
  const response = await fetch(`${apiUrl}/api/returns/${request.id}`, {
    headers: await session("customer-maya"),
    signal: AbortSignal.timeout(3000),
  });
  const recovered = returnDetailContract.assert(await response.json());
  assert.equal(recovered.status, "closed");
  assert.equal(recovered.refund?.id, operationId);
  assert.equal(recovered.refund?.providerReceiptId, providerId);
  assert.equal(recovered.history.filter((event) => event.event === "Refund succeeded").length, 1);
  const attempts = await db
    .select()
    .from(refundAttempts)
    .where(eq(refundAttempts.operationId, operationId));
  assert.deepEqual(attempts.map((attempt) => attempt.outcome).sort(), ["abandoned", "succeeded"]);
  const diagnostics = simulatorDiagnostics.assert(await control("diagnostics"));
  assert.equal(diagnostics.ledger.filter((entry) => entry.refundId === providerId).length, 1);
  console.log(
    "Verified actual worker crash after provider write, reclaimed lease, and one financial refund.",
  );
  const uncertain = await inspectedRequest();
  await control("payments", {
    merchantId: "northline",
    paymentRef: "payment-order-1042",
    mode: "drop_response",
    responseDelayMs: 0,
    eventDelayMs: 0,
    eventCopies: 1,
  });
  const queued = await post(
    `returns/${uncertain.id}/refund`,
    "finance-sam",
    {
      expectedAmountMinor: 3500,
      reason: "Verify status recovery through full service restart",
      correlationId: randomUUID(),
    },
    202,
  );
  assert.ok(queued.refund);
  const uncertainId = queued.refund.id;
  await until(async () => {
    const [result] = await db
      .select()
      .from(refundOperations)
      .where(eq(refundOperations.id, uncertainId));
    return result?.status === "unknown";
  }, "Dropped response did not become unknown");
  await restartApi(manifest, env);
  await restartRefundWorker(manifest, env);
  await restartSimulator(manifest, env);
  const checked = await post(
    `returns/${uncertain.id}/refund/check`,
    "finance-sam",
    { reason: "Recover the original payment after service restart", correlationId: randomUUID() },
    202,
  );
  assert.equal(checked.status, "closed");
  assert.equal(checked.refund?.status, "succeeded");
  assert.equal(checked.refund?.id, uncertainId);
  assert.ok(checked.refund?.providerReceiptId);
  const uncertainProviderId = checked.refund.providerReceiptId;
  await control("events", {
    refundId: uncertainProviderId,
    status: "failed",
    delayMs: 0,
    copies: 2,
  });
  await control("deliver", { refundId: uncertainProviderId });
  const observed = simulatorDiagnostics.assert(await control("diagnostics"));
  assert.equal(observed.ledger.filter((entry) => entry.refundId === uncertainProviderId).length, 1);
  const delivered = observed.deliveries.filter((entry) => entry.refundId === uncertainProviderId);
  assert.equal(delivered.length, 4);
  assert.ok(delivered.every((entry) => entry.deliveredAt && entry.lastStatus === 200));
  const finalResponse = await fetch(`${apiUrl}/api/returns/${uncertain.id}`, {
    headers: await session("customer-maya"),
    signal: AbortSignal.timeout(3000),
  });
  const final = returnDetailContract.assert(await finalResponse.json());
  assert.equal(final.refund?.status, "succeeded");
  assert.equal(final.history.filter((entry) => entry.event === "Refund succeeded").length, 1);
  const recoveryAttempts = await db
    .select()
    .from(refundAttempts)
    .where(eq(refundAttempts.operationId, uncertainId));
  assert.equal(recoveryAttempts.length, 1, "status recovery must not submit another attempt");
  console.log(
    "Verified lost-response recovery after actual API/worker/simulator restart, delayed processing, contradictory duplicate events, and one ledger refund.",
  );
}
