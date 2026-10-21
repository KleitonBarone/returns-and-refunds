import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { type } from "arktype";
import { and, eq } from "drizzle-orm";
import { type ProviderEvent, providerEvent } from "../../../packages/contracts/src/payment.ts";
import type { Database } from "./db.ts";
import { HttpError } from "./domain.ts";
import { type PaymentProvider, receiptMatches } from "./provider.ts";
import { acknowledgeRefundJob, applyRefundOutcome, validReceipt } from "./refund-state.ts";
import { lockRefundOperation } from "./refunds.ts";
import { providerEventReceipts, refundOperations } from "./schema.ts";

export function readSigningSecret(env: NodeJS.ProcessEnv = process.env) {
  return type("string >= 32").assert(env.SIMULATOR_SIGNING_SECRET);
}
export function verifyProviderEvent(
  raw: Buffer,
  timestamp: unknown,
  signature: unknown,
  secret: string,
  now = Date.now(),
) {
  if (
    typeof timestamp !== "string" ||
    !/^\d{1,13}$/.test(timestamp) ||
    Math.abs(now / 1000 - Number(timestamp)) > 300 ||
    typeof signature !== "string" ||
    !/^[0-9a-f]{64}$/.test(signature)
  )
    throw new HttpError(401, "Invalid payment event signature or timestamp");
  const expected = createHmac("sha256", secret).update(`${timestamp}.`).update(raw).digest();
  if (!timingSafeEqual(expected, Buffer.from(signature, "hex")))
    throw new HttpError(401, "Invalid payment event signature");
  let body: unknown;
  try {
    body = JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "Invalid payment event JSON");
  }
  const event = providerEvent(body);
  if (event instanceof type.errors) throw new HttpError(422, "Invalid payment event contract");
  return event;
}

// Terminal events are confirmed through lookup outside the transaction, including contradictory ones.
export async function acceptProviderEvent(
  db: Database,
  event: ProviderEvent,
  raw: Buffer,
  provider: PaymentProvider,
  businessNow: string,
) {
  const payloadHash = createHash("sha256").update(raw).digest("hex");
  const eventKey = and(
    eq(providerEventReceipts.provider, event.provider),
    eq(providerEventReceipts.eventId, event.id),
  );
  const [duplicate] = await db.select().from(providerEventReceipts).where(eventKey);
  if (duplicate) {
    if (duplicate.payloadHash !== payloadHash)
      throw new HttpError(409, "Payment event identity was reused with different content");
    return { duplicate: true };
  }
  const [reference] = await db
    .select()
    .from(refundOperations)
    .where(
      and(
        eq(refundOperations.merchantId, event.refund.merchantId),
        eq(refundOperations.idempotencyKey, event.refund.idempotencyKey),
      ),
    );
  if (!reference || !receiptMatches(reference, event.refund))
    throw new HttpError(422, "Payment event does not match a reserved refund");
  const lookup = event.refund.status === "processing" ? null : await provider.lookup(reference);
  if (lookup && lookup.kind !== "receipt")
    throw new HttpError(503, "Payment event confirmation is temporarily unavailable");
  const receipt = lookup?.receipt ?? event.refund;
  if (receipt.id !== event.refund.id || !receiptMatches(reference, receipt))
    throw new HttpError(422, "Payment event has a conflicting refund identity");
  return db.transaction(async (tx) => {
    const context = await lockRefundOperation(tx, reference.id);
    if (!(await validReceipt(tx, context.operation, receipt)))
      throw new HttpError(422, "Payment event has a conflicting refund identity");
    const now = Date.now();
    const inserted = await tx
      .insert(providerEventReceipts)
      .values({
        provider: event.provider,
        eventId: event.id,
        operationId: reference.id,
        payloadHash,
        payload: event,
        outcome: "ignored",
        receivedAt: new Date(now).toISOString(),
      })
      .onConflictDoNothing()
      .returning({ id: providerEventReceipts.eventId });
    if (!inserted.length) {
      const [previous] = await tx.select().from(providerEventReceipts).where(eventKey);
      if (previous?.payloadHash !== payloadHash)
        throw new HttpError(409, "Payment event identity was reused with different content");
      return { duplicate: true };
    }
    const applied = await applyRefundOutcome(
      tx,
      context,
      { kind: "receipt", receipt },
      businessNow,
      now,
      lookup !== null,
    );
    await acknowledgeRefundJob(tx, reference.id, now);
    const outcome =
      receipt.status !== event.refund.status
        ? "reconciled"
        : applied.changed
          ? "applied"
          : "ignored";
    await tx.update(providerEventReceipts).set({ outcome }).where(eventKey);
    return { duplicate: false };
  });
}
