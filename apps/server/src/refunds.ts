import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import type { Actor, refundInput } from "../../../packages/contracts/src/index.ts";
import type { Database, Transaction } from "./db.ts";
import { HttpError } from "./domain.ts";
import { payloadFingerprint } from "./provider.ts";
import {
  auditEntries,
  orders,
  orderUnits,
  refundJobs,
  refundOperations,
  returnRequests,
  returnUnits,
} from "./schema.ts";

export async function requestRefund(
  db: Database,
  actor: Actor,
  id: string,
  input: typeof refundInput.infer,
  now: string,
) {
  if (actor.role !== "finance") throw new HttpError(403, "This action requires the finance role");
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new HttpError(422, "Explain the refund in at least three characters");
  return db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ orderId: returnRequests.orderId })
      .from(returnRequests)
      .where(and(eq(returnRequests.id, id), eq(returnRequests.merchantId, actor.merchantId)));
    if (!reference) throw new HttpError(404, "Return not found");
    const [order] = await tx
      .select()
      .from(orders)
      .where(eq(orders.id, reference.orderId))
      .for("update");
    const [request] = await tx
      .select()
      .from(returnRequests)
      .where(eq(returnRequests.id, id))
      .for("update");
    if (!order || !request) throw new HttpError(404, "Return not found");
    const [existing] = await tx
      .select()
      .from(refundOperations)
      .where(eq(refundOperations.returnId, id));
    if (existing) {
      if (existing.amountMinor !== input.expectedAmountMinor)
        throw new HttpError(409, "The confirmed refund amount does not match this operation");
      return existing.id;
    }
    if (request.status !== "inspection_passed")
      throw new HttpError(409, "A passing inspection is required before refunding");
    const claims = await tx
      .select({
        amount: returnUnits.amountMinor,
        active: returnUnits.active,
        consumed: orderUnits.consumed,
      })
      .from(returnUnits)
      .innerJoin(orderUnits, eq(orderUnits.id, returnUnits.unitId))
      .where(eq(returnUnits.returnId, id));
    const amount = claims.reduce((sum, claim) => sum + claim.amount, 0);
    if (
      !claims.length ||
      claims.some((claim) => !claim.active || claim.consumed !== 0) ||
      !Number.isSafeInteger(amount) ||
      amount <= 0 ||
      amount !== request.amountMinor ||
      amount !== input.expectedAmountMinor ||
      request.currency !== order.currency
    )
      throw new HttpError(
        409,
        "The confirmed amount or reserved items changed. Refresh this return.",
      );
    // Failed operations also keep their reservation until an explicit resolution flow exists.
    const reserved = await tx
      .select({ amount: refundOperations.amountMinor })
      .from(refundOperations)
      .where(eq(refundOperations.orderId, order.id));
    const total = reserved.reduce((sum, operation) => sum + operation.amount, amount);
    if (!Number.isSafeInteger(total) || total > order.capturedMinor)
      throw new HttpError(409, "This refund exceeds the order's remaining captured amount");
    const operationId = randomUUID();
    const payload = {
      merchantId: actor.merchantId,
      paymentRef: order.paymentRef,
      idempotencyKey: `return-refund-${operationId}`,
      amountMinor: amount,
      currency: request.currency,
    };
    await tx.insert(refundOperations).values({
      id: operationId,
      returnId: id,
      orderId: order.id,
      createdBy: actor.id,
      correlationId: input.correlationId,
      ...payload,
      fingerprint: payloadFingerprint(payload),
      requestedAt: now,
      updatedAt: now,
    });
    await tx.insert(refundJobs).values({ operationId, runAt: new Date().toISOString() });
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      operationId,
      correlationId: input.correlationId,
      returnId: id,
      merchantId: actor.merchantId,
      actorId: actor.id,
      event: "Refund requested",
      reason,
      fromStatus: request.status,
      toStatus: request.status,
      refundToStatus: "pending",
      at: now,
    });
    return operationId;
  });
}
// Worker and future recovery/event writes share the same order -> return -> operation lock order.
export async function lockRefundOperation(tx: Transaction, operationId: string) {
  const [reference] = await tx
    .select({ orderId: refundOperations.orderId, returnId: refundOperations.returnId })
    .from(refundOperations)
    .where(eq(refundOperations.id, operationId));
  if (!reference) throw new Error("Refund operation missing");
  const [order] = await tx
    .select()
    .from(orders)
    .where(eq(orders.id, reference.orderId))
    .for("update");
  const [request] = await tx
    .select()
    .from(returnRequests)
    .where(eq(returnRequests.id, reference.returnId))
    .for("update");
  const [operation] = await tx
    .select()
    .from(refundOperations)
    .where(eq(refundOperations.id, operationId))
    .for("update");
  if (!order || !request || !operation) throw new Error("Refund operation references are missing");
  return { order, request, operation };
}
