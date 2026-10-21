import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull, lte, ne, or } from "drizzle-orm";
import { money } from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import { REFUND_PROCESSOR } from "./domain.ts";
import {
  type PaymentProvider,
  payloadFingerprint,
  receiptMatches,
  type SubmissionOutcome,
} from "./provider.ts";
import { lockRefundOperation } from "./refunds.ts";
import {
  auditEntries,
  orderUnits,
  refundAttempts,
  refundJobs,
  refundOperations,
  refundReceipts,
  returnRequests,
  returnUnits,
} from "./schema.ts";

export const REFUND_LEASE_MS = 10000;
export async function claimRefundJob(
  db: Database,
  businessNow: string,
  options: { now?: number; operationId?: string } = {},
) {
  const now = options.now ?? Date.now();
  const instant = new Date(now).toISOString();
  const [candidate] = await db
    .select({ id: refundJobs.operationId })
    .from(refundJobs)
    .innerJoin(refundOperations, eq(refundOperations.id, refundJobs.operationId))
    .where(
      and(
        isNull(refundJobs.completedAt),
        lte(refundJobs.runAt, instant),
        or(isNull(refundJobs.leaseUntil), lte(refundJobs.leaseUntil, instant)),
        inArray(refundOperations.status, ["pending", "processing"]),
        options.operationId ? eq(refundJobs.operationId, options.operationId) : undefined,
      ),
    )
    .orderBy(asc(refundJobs.runAt), asc(refundJobs.operationId))
    .limit(1);
  if (!candidate) return null;
  return db.transaction(async (tx) => {
    const { operation, request } = await lockRefundOperation(tx, candidate.id);
    const [job] = await tx
      .select()
      .from(refundJobs)
      .where(eq(refundJobs.operationId, operation.id))
      .for("update");
    if (
      !job ||
      job.completedAt ||
      Date.parse(job.runAt) > now ||
      (job.leaseUntil && Date.parse(job.leaseUntil) > now) ||
      !["pending", "processing"].includes(operation.status)
    )
      return null;
    const token = randomUUID();
    const attemptId = randomUUID();
    await tx
      .update(refundAttempts)
      .set({
        outcome: "abandoned",
        finishedAt: instant,
        message: "Worker lease expired before acknowledgement",
      })
      .where(
        and(eq(refundAttempts.operationId, operation.id), eq(refundAttempts.outcome, "started")),
      );
    await tx
      .update(refundJobs)
      .set({
        leaseToken: token,
        leaseUntil: new Date(now + REFUND_LEASE_MS).toISOString(),
        attempts: job.attempts + 1,
      })
      .where(eq(refundJobs.operationId, operation.id));
    await tx.insert(refundAttempts).values({
      id: attemptId,
      operationId: operation.id,
      leaseToken: token,
      startedAt: instant,
      outcome: "started",
    });
    await tx
      .update(refundOperations)
      .set({ status: "processing", updatedAt: businessNow, lastError: null })
      .where(eq(refundOperations.id, operation.id));
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      operationId: operation.id,
      correlationId: operation.correlationId,
      returnId: request.id,
      merchantId: operation.merchantId,
      actorId: REFUND_PROCESSOR.id,
      event: "Refund submission started",
      reason: "Submitting the reserved amount to the payment service.",
      fromStatus: request.status,
      toStatus: request.status,
      refundFromStatus: operation.status,
      refundToStatus: "processing",
      at: businessNow,
    });
    const payload = {
      merchantId: operation.merchantId,
      paymentRef: operation.paymentRef,
      idempotencyKey: operation.idempotencyKey,
      amountMinor: operation.amountMinor,
      currency: operation.currency,
    };
    return {
      operationId: operation.id,
      attemptId,
      token,
      attemptNumber: job.attempts + 1,
      payload,
      fingerprint: operation.fingerprint,
    };
  });
}
export type ClaimedRefund = NonNullable<Awaited<ReturnType<typeof claimRefundJob>>>;

// Completion rechecks ownership under the order lock; HTTP has already finished.
export async function completeRefundJob(
  db: Database,
  claim: ClaimedRefund,
  submitted: SubmissionOutcome,
  businessNow: string,
  now = Date.now(),
) {
  return db.transaction(async (tx) => {
    const { operation, request } = await lockRefundOperation(tx, claim.operationId);
    const [job] = await tx
      .select()
      .from(refundJobs)
      .where(eq(refundJobs.operationId, operation.id))
      .for("update");
    const instant = new Date(now).toISOString();
    if (
      !job ||
      job.completedAt ||
      job.leaseToken !== claim.token ||
      operation.status === "succeeded" ||
      operation.status === "failed"
    ) {
      await tx
        .update(refundAttempts)
        .set({ outcome: "fenced", finishedAt: instant })
        .where(and(eq(refundAttempts.id, claim.attemptId), eq(refundAttempts.outcome, "started")));
      return { applied: false };
    }
    let outcome = submitted;
    if (outcome.kind === "receipt") {
      const [previous] = await tx
        .select()
        .from(refundReceipts)
        .where(eq(refundReceipts.operationId, operation.id));
      const [reused] = await tx
        .select()
        .from(refundReceipts)
        .where(
          and(
            eq(refundReceipts.providerId, outcome.receipt.id),
            ne(refundReceipts.operationId, operation.id),
          ),
        );
      if (
        !receiptMatches(claim.payload, outcome.receipt) ||
        (previous && previous.providerId !== outcome.receipt.id) ||
        reused
      )
        outcome = {
          kind: "unknown",
          message:
            "The payment service returned a conflicting refund identity. A status check is required.",
        };
    }
    const status =
      outcome.kind === "receipt"
        ? outcome.receipt.status
        : outcome.kind === "retryable"
          ? "pending"
          : "unknown";
    const message =
      outcome.kind !== "receipt"
        ? outcome.message
        : status === "failed"
          ? "The payment service rejected this refund. It cannot be submitted again."
          : null;
    if (outcome.kind === "receipt")
      await tx
        .insert(refundReceipts)
        .values({
          operationId: operation.id,
          providerId: outcome.receipt.id,
          receipt: outcome.receipt,
          observedAt: instant,
        })
        .onConflictDoUpdate({
          target: refundReceipts.operationId,
          set: { receipt: outcome.receipt, observedAt: instant },
        });
    await tx
      .update(refundOperations)
      .set({ status, lastError: message, updatedAt: businessNow })
      .where(eq(refundOperations.id, operation.id));
    await tx
      .update(refundJobs)
      .set({
        leaseToken: null,
        leaseUntil: null,
        completedAt: outcome.kind === "retryable" ? null : instant,
        runAt: new Date(
          now + Math.min(30000, 1000 * 2 ** Math.min(claim.attemptNumber - 1, 5)),
        ).toISOString(),
      })
      .where(eq(refundJobs.operationId, operation.id));
    await tx
      .update(refundAttempts)
      .set({
        outcome: outcome.kind === "receipt" ? outcome.receipt.status : outcome.kind,
        finishedAt: instant,
        message,
      })
      .where(eq(refundAttempts.id, claim.attemptId));
    if (status === "succeeded") {
      if (request.status !== "inspection_passed")
        throw new Error("Refund success requires an inspected return");
      const units = await tx
        .select({ id: returnUnits.unitId })
        .from(returnUnits)
        .where(eq(returnUnits.returnId, request.id));
      if (!units.length) throw new Error("Refund return has no units");
      await tx
        .update(orderUnits)
        .set({ consumed: 1 })
        .where(
          inArray(
            orderUnits.id,
            units.map((unit) => unit.id),
          ),
        );
      await tx
        .update(returnUnits)
        .set({ active: false })
        .where(eq(returnUnits.returnId, request.id));
      await tx
        .update(returnRequests)
        .set({ status: "closed", closureReason: "refunded" })
        .where(eq(returnRequests.id, request.id));
    }
    const event =
      status === "pending"
        ? "Refund will retry"
        : status === "unknown"
          ? "Refund outcome unknown"
          : status === "failed"
            ? "Refund failed"
            : status === "succeeded"
              ? "Refund succeeded"
              : "Refund processing confirmed";
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      operationId: operation.id,
      correlationId: operation.correlationId,
      returnId: request.id,
      merchantId: operation.merchantId,
      actorId: REFUND_PROCESSOR.id,
      event,
      reason:
        message ??
        (status === "succeeded"
          ? `Confirmed ${money(operation.amountMinor, operation.currency)} refund.`
          : "The payment service accepted the refund for processing."),
      fromStatus: request.status,
      toStatus: status === "succeeded" ? "closed" : request.status,
      refundFromStatus: operation.status,
      refundToStatus: status,
      at: businessNow,
    });
    return { applied: true, status };
  });
}
export async function processRefundJob(
  db: Database,
  provider: PaymentProvider,
  businessNow: string,
  options: { now?: number; operationId?: string } = {},
) {
  const claim = await claimRefundJob(db, businessNow, options);
  if (!claim) return null;
  const result: SubmissionOutcome =
    payloadFingerprint(claim.payload) !== claim.fingerprint
      ? {
          kind: "unknown",
          message: "The reserved refund payload changed. A status check is required.",
        }
      : await provider.submit(claim.payload);
  return completeRefundJob(db, claim, result, businessNow, options.now ?? Date.now());
}
