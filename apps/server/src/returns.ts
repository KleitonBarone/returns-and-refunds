import { createHash, randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, isNull } from "drizzle-orm";
import type { Actor, requestInput } from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import { eligibility, HttpError } from "./domain.ts";
import {
  auditEntries,
  customers,
  orderLines,
  orders,
  orderUnits,
  refundOperations,
  refundReceipts,
  returnRequests,
  returnReviews,
  returnUnits,
  users,
} from "./schema.ts";

export async function listOrders(db: Database, actor: Actor, now: string) {
  if (actor.role !== "customer" || !actor.customerId)
    throw new HttpError(403, "Only customers can access their orders");
  const owned = await db
    .select()
    .from(orders)
    .where(and(eq(orders.merchantId, actor.merchantId), eq(orders.customerId, actor.customerId)))
    .orderBy(desc(orders.deliveredAt));
  return Promise.all(
    owned.map(async (order) => {
      const lines = await db.select().from(orderLines).where(eq(orderLines.orderId, order.id));
      const available = await db
        .select({ id: orderUnits.id, lineId: orderUnits.lineId, netMinor: orderUnits.netMinor })
        .from(orderUnits)
        .innerJoin(orderLines, eq(orderLines.id, orderUnits.lineId))
        .leftJoin(
          returnUnits,
          and(eq(returnUnits.unitId, orderUnits.id), eq(returnUnits.active, true)),
        )
        .where(
          and(
            eq(orderLines.orderId, order.id),
            eq(orderUnits.consumed, 0),
            isNull(returnUnits.unitId),
          ),
        )
        .orderBy(asc(orderUnits.position));
      return {
        id: order.id,
        number: order.number,
        currency: order.currency,
        capturedMinor: order.capturedMinor,
        deliveredAt: order.deliveredAt,
        ...eligibility(order.deliveredAt, now),
        lines: lines.map((line) => {
          const units = available.filter((unit) => unit.lineId === line.id);
          return {
            id: line.id,
            name: line.name,
            variant: line.variant,
            quantity: line.quantity,
            available: units.length,
            unitValues: units.map((unit) => unit.netMinor),
          };
        }),
      };
    }),
  );
}
const summaryFields = {
  id: returnRequests.id,
  orderId: orders.id,
  orderNumber: orders.number,
  customerName: users.name,
  reason: returnRequests.reason,
  status: returnRequests.status,
  closureReason: returnRequests.closureReason,
  refundStatus: refundOperations.status,
  amountMinor: returnRequests.amountMinor,
  currency: returnRequests.currency,
  requestedAt: returnRequests.requestedAt,
  deadline: returnRequests.deadline,
  policyVersion: returnRequests.policyVersion,
};
function returnScope(actor: Actor) {
  return and(
    eq(returnRequests.merchantId, actor.merchantId),
    actor.role === "customer" ? eq(returnRequests.customerId, actor.customerId ?? "") : undefined,
  );
}
export async function listReturns(db: Database, actor: Actor) {
  return db
    .select(summaryFields)
    .from(returnRequests)
    .leftJoin(refundOperations, eq(refundOperations.returnId, returnRequests.id))
    .innerJoin(orders, eq(orders.id, returnRequests.orderId))
    .innerJoin(customers, eq(customers.id, returnRequests.customerId))
    .innerJoin(users, eq(users.id, customers.userId))
    .where(returnScope(actor))
    .orderBy(desc(returnRequests.requestedAt));
}
export async function returnDetail(db: Database, actor: Actor, id: string) {
  return db.transaction(
    async (tx) => {
      const [summary] = await tx
        .select(summaryFields)
        .from(returnRequests)
        .leftJoin(refundOperations, eq(refundOperations.returnId, returnRequests.id))
        .innerJoin(orders, eq(orders.id, returnRequests.orderId))
        .innerJoin(customers, eq(customers.id, returnRequests.customerId))
        .innerJoin(users, eq(users.id, customers.userId))
        .where(and(returnScope(actor), eq(returnRequests.id, id)));
      if (!summary) throw new HttpError(404, "Return not found");
      const items = await tx
        .select({
          unitId: returnUnits.unitId,
          amountMinor: returnUnits.amountMinor,
          name: orderLines.name,
          variant: orderLines.variant,
        })
        .from(returnUnits)
        .innerJoin(orderUnits, eq(orderUnits.id, returnUnits.unitId))
        .innerJoin(orderLines, eq(orderLines.id, orderUnits.lineId))
        .where(eq(returnUnits.returnId, id));
      const history = await tx
        .select({
          id: auditEntries.id,
          actorName: users.name,
          event: auditEntries.event,
          reason: auditEntries.reason,
          at: auditEntries.at,
          fromStatus: auditEntries.fromStatus,
          toStatus: auditEntries.toStatus,
          correlationId: auditEntries.correlationId,
          operationId: auditEntries.operationId,
          refundFromStatus: auditEntries.refundFromStatus,
          refundToStatus: auditEntries.refundToStatus,
        })
        .from(auditEntries)
        .innerJoin(users, eq(users.id, auditEntries.actorId))
        .where(eq(auditEntries.returnId, id))
        .orderBy(asc(auditEntries.sequence));
      const reviews = await tx
        .select({
          kind: returnReviews.kind,
          outcome: returnReviews.outcome,
          reason: returnReviews.reason,
          actorName: users.name,
          at: returnReviews.at,
        })
        .from(returnReviews)
        .innerJoin(users, eq(users.id, returnReviews.actorId))
        .where(eq(returnReviews.returnId, id));
      const [refund] = await tx
        .select({
          id: refundOperations.id,
          status: refundOperations.status,
          amountMinor: refundOperations.amountMinor,
          currency: refundOperations.currency,
          requestedAt: refundOperations.requestedAt,
          updatedAt: refundOperations.updatedAt,
          message: refundOperations.lastError,
          lastLookup: refundOperations.lastLookup,
          checkedAt: refundOperations.checkedAt,
          providerReceiptId: refundReceipts.providerId,
        })
        .from(refundOperations)
        .leftJoin(refundReceipts, eq(refundReceipts.operationId, refundOperations.id))
        .where(eq(refundOperations.returnId, id));
      return { ...summary, items, history, reviews, refund: refund ?? null };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}
function requestFingerprint(input: Omit<typeof requestInput.infer, "requestKey">) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        orderId: input.orderId,
        reason: input.reason.trim(),
        items: [...input.items]
          .sort((a, b) => a.lineId.localeCompare(b.lineId))
          .map(({ lineId, quantity }) => ({ lineId, quantity })),
      }),
    )
    .digest("hex");
}

export async function requestReturn(
  db: Database,
  actor: Actor,
  input: typeof requestInput.infer,
  now: string,
) {
  if (actor.role !== "customer" || !actor.customerId)
    throw new HttpError(403, "Only customers can request a return");
  const customerId = actor.customerId;
  if (input.reason.trim().length < 3)
    throw new HttpError(422, "Give a return reason of at least three characters");
  if (
    !input.items.length ||
    input.items.length > 20 ||
    new Set(input.items.map((item) => item.lineId)).size !== input.items.length
  )
    throw new HttpError(422, "Select each order line once with a positive quantity");
  const fingerprint = requestFingerprint(input);
  const id = await db.transaction(async (tx) => {
    const [order] = await tx
      .select()
      .from(orders)
      .where(
        and(
          eq(orders.id, input.orderId),
          eq(orders.merchantId, actor.merchantId),
          eq(orders.customerId, customerId),
        ),
      )
      .for("update");
    if (!order) throw new HttpError(404, "Order not found");
    const [existing] = await tx
      .select()
      .from(returnRequests)
      .where(
        and(
          eq(returnRequests.customerId, customerId),
          eq(returnRequests.requestKey, input.requestKey),
        ),
      );
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        // Older hashes depended on JSON key order. Rebuild their meaning from the saved claims.
        const items = await tx
          .select({ lineId: orderUnits.lineId, quantity: count() })
          .from(returnUnits)
          .innerJoin(orderUnits, eq(orderUnits.id, returnUnits.unitId))
          .where(eq(returnUnits.returnId, existing.id))
          .groupBy(orderUnits.lineId);
        if (
          requestFingerprint({ orderId: existing.orderId, reason: existing.reason, items }) !==
          fingerprint
        )
          throw new HttpError(409, "This submission key already belongs to a different request");
        await tx
          .update(returnRequests)
          .set({ fingerprint })
          .where(eq(returnRequests.id, existing.id));
      }
      return existing.id;
    }
    const policy = eligibility(order.deliveredAt, now);
    if (!policy.eligible)
      throw new HttpError(422, "This order is outside the 30-day return window");
    const selected = [];
    for (const item of input.items) {
      const units = await tx
        .select({ id: orderUnits.id, netMinor: orderUnits.netMinor })
        .from(orderUnits)
        .innerJoin(orderLines, eq(orderLines.id, orderUnits.lineId))
        .leftJoin(
          returnUnits,
          and(eq(returnUnits.unitId, orderUnits.id), eq(returnUnits.active, true)),
        )
        .where(
          and(
            eq(orderLines.orderId, order.id),
            eq(orderLines.id, item.lineId),
            eq(orderUnits.consumed, 0),
            isNull(returnUnits.unitId),
          ),
        )
        .orderBy(asc(orderUnits.position))
        .limit(item.quantity);
      if (units.length !== item.quantity)
        throw new HttpError(
          409,
          "Some selected units are already reserved or returned. Refresh the order.",
        );
      selected.push(...units);
    }
    const amountMinor = selected.reduce((sum, unit) => sum + unit.netMinor, 0);
    if (!Number.isSafeInteger(amountMinor) || amountMinor <= 0 || amountMinor > order.capturedMinor)
      throw new HttpError(422, "Invalid return amount");
    const returnId = randomUUID();
    const [created] = await tx
      .insert(returnRequests)
      .values({
        id: returnId,
        orderId: order.id,
        merchantId: actor.merchantId,
        customerId,
        requestKey: input.requestKey,
        fingerprint,
        reason: input.reason.trim(),
        amountMinor,
        currency: order.currency,
        requestedAt: now,
        deadline: policy.deadline,
        policyVersion: policy.policyVersion,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) throw new HttpError(409, "Submission key already used. Refresh the request.");
    await tx
      .insert(returnUnits)
      .values(selected.map((unit) => ({ returnId, unitId: unit.id, amountMinor: unit.netMinor })));
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      correlationId: input.requestKey,
      returnId,
      merchantId: actor.merchantId,
      actorId: actor.id,
      event: "Return requested",
      reason: input.reason.trim(),
      toStatus: "requested",
      at: now,
    });
    return returnId;
  });
  return returnDetail(db, actor, id);
}
