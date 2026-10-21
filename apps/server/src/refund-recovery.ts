import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Actor, recoveryInput } from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import { HttpError } from "./domain.ts";
import { type PaymentProvider, payloadFingerprint } from "./provider.ts";
import { acknowledgeRefundJob, applyRefundOutcome, validReceipt } from "./refund-state.ts";
import { lockRefundOperation } from "./refunds.ts";
import { auditEntries, refundJobs, refundOperations } from "./schema.ts";

async function scopedOperation(db: Database, actor: Actor, returnId: string) {
  if (actor.role !== "finance") throw new HttpError(403, "This action requires the finance role");
  const [operation] = await db
    .select()
    .from(refundOperations)
    .where(
      and(
        eq(refundOperations.returnId, returnId),
        eq(refundOperations.merchantId, actor.merchantId),
      ),
    );
  if (!operation) throw new HttpError(404, "Refund not found");
  return operation;
}
function recoveryReason(input: typeof recoveryInput.infer) {
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new HttpError(422, "Explain this action in at least three characters");
  return reason;
}
export async function checkRefund(
  db: Database,
  actor: Actor,
  returnId: string,
  input: typeof recoveryInput.infer,
  provider: PaymentProvider,
  businessNow: string,
) {
  const reason = recoveryReason(input);
  const reference = await scopedOperation(db, actor, returnId);
  if (reference.status === "succeeded" || reference.status === "failed") return;
  if (reference.status === "pending")
    throw new HttpError(
      409,
      "The refund is queued. Wait for its submission before checking status.",
    );
  let result = await provider.lookup(reference);
  await db.transaction(async (tx) => {
    const context = await lockRefundOperation(tx, reference.id);
    const { operation, request } = context;
    if (
      operation.status === "succeeded" ||
      operation.status === "failed" ||
      operation.status === "pending"
    )
      return;
    const now = Date.now();
    if (result.kind === "receipt" && !(await validReceipt(tx, operation, result.receipt)))
      result = {
        kind: "unavailable",
        message:
          "The payment status returned a conflicting refund identity. The original operation remains reserved.",
      };
    const lastLookup = result.kind === "receipt" ? "found" : result.kind;
    const outcome =
      result.kind === "receipt"
        ? result
        : {
            kind: "unknown" as const,
            message:
              result.kind === "not_found"
                ? "No refund was found for the original key. Finance may retry this same operation."
                : result.message,
          };
    const applied = await applyRefundOutcome(tx, context, outcome, businessNow, now, true);
    if (result.kind === "receipt") await acknowledgeRefundJob(tx, operation.id, now);
    await tx
      .update(refundOperations)
      .set({ lastLookup, checkedAt: new Date(now).toISOString() })
      .where(eq(refundOperations.id, operation.id));
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      operationId: operation.id,
      correlationId: input.correlationId,
      returnId,
      merchantId: actor.merchantId,
      actorId: actor.id,
      event: "Refund status checked",
      reason,
      fromStatus: request.status,
      toStatus: applied.status === "succeeded" ? "closed" : request.status,
      refundFromStatus: operation.status,
      refundToStatus: applied.status,
      at: businessNow,
    });
  });
}
export async function retryRefund(
  db: Database,
  actor: Actor,
  returnId: string,
  input: typeof recoveryInput.infer,
  businessNow: string,
) {
  const reason = recoveryReason(input);
  const reference = await scopedOperation(db, actor, returnId);
  await db.transaction(async (tx) => {
    const context = await lockRefundOperation(tx, reference.id);
    const { operation, request } = context;
    if (
      operation.status === "pending" ||
      operation.status === "processing" ||
      operation.status === "succeeded"
    )
      return;
    if (operation.status !== "unknown" || operation.lastLookup !== "not_found")
      throw new HttpError(
        409,
        "Check the original refund first. Only a verified missing refund can retry.",
      );
    if (payloadFingerprint(operation) !== operation.fingerprint)
      throw new HttpError(409, "The reserved refund payload changed. It cannot be retried.");
    const now = Date.now();
    await acknowledgeRefundJob(tx, operation.id, now);
    const jobs = await tx
      .update(refundJobs)
      .set({ runAt: new Date(now).toISOString(), completedAt: null })
      .where(eq(refundJobs.operationId, operation.id))
      .returning({ id: refundJobs.operationId });
    if (jobs.length !== 1) throw new Error("Refund outbox job missing");
    await tx
      .update(refundOperations)
      .set({ status: "pending", lastError: null, lastLookup: null, updatedAt: businessNow })
      .where(eq(refundOperations.id, operation.id));
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      operationId: operation.id,
      correlationId: input.correlationId,
      returnId,
      merchantId: actor.merchantId,
      actorId: actor.id,
      event: "Refund retry requested",
      reason,
      fromStatus: request.status,
      toStatus: request.status,
      refundFromStatus: operation.status,
      refundToStatus: "pending",
      at: businessNow,
    });
  });
}
