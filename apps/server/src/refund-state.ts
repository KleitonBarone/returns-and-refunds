import { randomUUID } from "node:crypto";
import { and, eq, inArray, ne } from "drizzle-orm";
import { money } from "../../../packages/contracts/src/index.ts";
import type { ProviderReceipt } from "../../../packages/contracts/src/payment.ts";
import type { Transaction } from "./db.ts";
import { REFUND_PROCESSOR } from "./domain.ts";
import { payloadFingerprint, receiptMatches, type SubmissionOutcome } from "./provider.ts";
import type { lockRefundOperation } from "./refunds.ts";
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

type LockedRefund = Awaited<ReturnType<typeof lockRefundOperation>>;

export async function validReceipt(
  tx: Transaction,
  operation: LockedRefund["operation"],
  receipt: ProviderReceipt,
) {
  const [previous] = await tx
    .select()
    .from(refundReceipts)
    .where(eq(refundReceipts.operationId, operation.id));
  const [reused] = await tx
    .select()
    .from(refundReceipts)
    .where(
      and(eq(refundReceipts.providerId, receipt.id), ne(refundReceipts.operationId, operation.id)),
    );
  return (
    receiptMatches(operation, receipt) &&
    payloadFingerprint(operation) === operation.fingerprint &&
    (!previous || previous.providerId === receipt.id) &&
    !reused
  );
}

// Every writer holds the order -> return -> operation locks before changing money or units.
export async function applyRefundOutcome(
  tx: Transaction,
  { operation, request }: LockedRefund,
  outcome: SubmissionOutcome,
  businessNow: string,
  now: number,
  authoritative = false,
): Promise<{ changed: boolean; status: LockedRefund["operation"]["status"] }> {
  const status =
    outcome.kind === "receipt"
      ? outcome.receipt.status
      : outcome.kind === "retryable"
        ? "pending"
        : "unknown";
  if (operation.status === "succeeded" && status !== "succeeded")
    return { changed: false, status: operation.status };
  if (
    operation.status === "failed" &&
    status !== "failed" &&
    !(authoritative && status === "succeeded")
  )
    return { changed: false, status: operation.status };
  const message =
    outcome.kind !== "receipt"
      ? outcome.message
      : status === "failed"
        ? "The payment service rejected this refund. It cannot be submitted again."
        : null;
  const instant = new Date(now).toISOString();
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
  if (status === operation.status) return { changed: false, status };
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
    await tx.update(returnUnits).set({ active: false }).where(eq(returnUnits.returnId, request.id));
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
  return { changed: true, status };
}

export async function acknowledgeRefundJob(tx: Transaction, operationId: string, now: number) {
  const instant = new Date(now).toISOString();
  await tx
    .update(refundJobs)
    .set({ completedAt: instant, leaseToken: null, leaseUntil: null })
    .where(eq(refundJobs.operationId, operationId));
  await tx
    .update(refundAttempts)
    .set({
      outcome: "fenced",
      finishedAt: instant,
      message: "A verified payment observation completed this job.",
    })
    .where(and(eq(refundAttempts.operationId, operationId), eq(refundAttempts.outcome, "started")));
}
