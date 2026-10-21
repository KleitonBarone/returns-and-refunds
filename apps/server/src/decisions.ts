import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  type Actor,
  type actionInput,
  returnActions,
} from "../../../packages/contracts/src/index.ts";
import type { Database } from "./db.ts";
import { HttpError } from "./domain.ts";
import { returnDetail } from "./returns.ts";
import { auditEntries, orders, returnRequests, returnReviews, returnUnits } from "./schema.ts";

// All unit-affecting mutations lock the order before the return, including closure.
export async function decideReturn(
  db: Database,
  actor: Actor,
  id: string,
  input: typeof actionInput.infer,
  now: string,
) {
  const rule = returnActions.find((action) => action.name === input.action);
  if (!rule) throw new HttpError(400, "Unknown return action");
  if (actor.role !== rule.role)
    throw new HttpError(403, `This action requires the ${rule.role} role`);
  const reason = input.reason.trim();
  if (reason.length < 3)
    throw new HttpError(422, "Explain this action in at least three characters");
  await db.transaction(async (tx) => {
    const [reference] = await tx
      .select({ orderId: returnRequests.orderId })
      .from(returnRequests)
      .where(and(eq(returnRequests.id, id), eq(returnRequests.merchantId, actor.merchantId)));
    if (!reference) throw new HttpError(404, "Return not found");
    await tx
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, reference.orderId))
      .for("update");
    const [request] = await tx
      .select()
      .from(returnRequests)
      .where(eq(returnRequests.id, id))
      .for("update");
    if (!request) throw new HttpError(404, "Return not found");
    if (request.status !== input.expectedStatus || request.status !== rule.from)
      throw new HttpError(
        409,
        "This return changed or is not ready for this action. Refresh its history.",
      );
    const rejected = input.action === "reject";
    const failed = input.action === "fail_inspection";
    const closing = rejected || failed;
    if (input.action === "approve" || rejected)
      await tx.insert(returnReviews).values({
        returnId: id,
        kind: "decision",
        outcome: rejected ? "rejected" : "approved",
        reason,
        actorId: actor.id,
        at: now,
      });
    if (input.action === "pass_inspection" || failed)
      await tx.insert(returnReviews).values({
        returnId: id,
        kind: "inspection",
        outcome: failed ? "failed" : "passed",
        reason,
        actorId: actor.id,
        at: now,
      });
    await tx
      .update(returnRequests)
      .set({
        status: closing ? "closed" : rule.to,
        closureReason: rejected ? "rejected" : failed ? "inspection_failed" : null,
      })
      .where(eq(returnRequests.id, id));
    await tx.insert(auditEntries).values({
      id: randomUUID(),
      correlationId: input.correlationId,
      returnId: id,
      merchantId: actor.merchantId,
      actorId: actor.id,
      event: rule.event,
      reason,
      fromStatus: request.status,
      toStatus: rule.to,
      at: now,
    });
    if (failed)
      await tx.insert(auditEntries).values({
        id: randomUUID(),
        correlationId: input.correlationId,
        returnId: id,
        merchantId: actor.merchantId,
        actorId: actor.id,
        event: "Return closed",
        reason: `Inspection failed: ${reason}`,
        fromStatus: "inspection_failed",
        toStatus: "closed",
        at: now,
      });
    if (closing)
      await tx.update(returnUnits).set({ active: false }).where(eq(returnUnits.returnId, id));
  });
  return returnDetail(db, actor, id);
}
