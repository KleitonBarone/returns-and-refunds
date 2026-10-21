import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import type {
  controlInput,
  ProviderReceipt,
  refundSubmission,
} from "../../../packages/contracts/src/payment.ts";
import type { SimulatorDatabase } from "./db.ts";
import { enqueueEvents } from "./events.ts";
import { captures, controls, ledger, simulatorRefunds } from "./schema.ts";

export class SimulatorError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export const receiptFields = {
  id: simulatorRefunds.id,
  merchantId: simulatorRefunds.merchantId,
  paymentRef: simulatorRefunds.paymentRef,
  idempotencyKey: simulatorRefunds.idempotencyKey,
  amountMinor: simulatorRefunds.amountMinor,
  currency: simulatorRefunds.currency,
  status: simulatorRefunds.status,
  failureCode: simulatorRefunds.failureCode,
};
export async function lookupRefund(db: SimulatorDatabase, merchantId: string, key: string) {
  const [refund] = await db
    .select(receiptFields)
    .from(simulatorRefunds)
    .where(
      and(eq(simulatorRefunds.merchantId, merchantId), eq(simulatorRefunds.idempotencyKey, key)),
    );
  return refund ?? null;
}
export async function configurePayment(db: SimulatorDatabase, input: typeof controlInput.infer) {
  const [capture] = await db
    .select()
    .from(captures)
    .where(
      and(eq(captures.merchantId, input.merchantId), eq(captures.paymentRef, input.paymentRef)),
    );
  if (!capture) throw new SimulatorError(404, "Captured payment not found");
  const values = { ...input, failuresRemaining: input.mode === "retry_once" ? 1 : 0 };
  await db
    .insert(controls)
    .values(values)
    .onConflictDoUpdate({ target: [controls.merchantId, controls.paymentRef], set: values });
}
// Capture lock serializes all operations against this payment, not just a single key.
export async function submitRefund(
  db: SimulatorDatabase,
  merchantId: string,
  input: typeof refundSubmission.infer,
  occurredAt: string,
) {
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        merchantId,
        paymentRef: input.paymentRef,
        amountMinor: input.amountMinor,
        currency: input.currency,
      }),
    )
    .digest("hex");
  return db.transaction(async (tx) => {
    const [capture] = await tx
      .select()
      .from(captures)
      .where(and(eq(captures.merchantId, merchantId), eq(captures.paymentRef, input.paymentRef)))
      .for("update");
    if (!capture) throw new SimulatorError(404, "Captured payment not found");
    const [existing] = await tx
      .select()
      .from(simulatorRefunds)
      .where(
        and(
          eq(simulatorRefunds.merchantId, merchantId),
          eq(simulatorRefunds.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) {
      if (existing.fingerprint !== fingerprint)
        throw new SimulatorError(409, "Idempotency key payload conflict");
      const { fingerprint: _fingerprint, ...receipt } = existing;
      return {
        kind: "receipt" as const,
        receipt,
        mode: "success" as const,
        responseDelayMs: 0,
        replay: true,
      };
    }
    if (capture.currency !== input.currency)
      throw new SimulatorError(422, "Payment currency mismatch");
    const [reserved] = await tx
      .select({ amount: sql<number>`coalesce(sum(${simulatorRefunds.amountMinor}), 0)::int` })
      .from(simulatorRefunds)
      .where(
        and(
          eq(simulatorRefunds.merchantId, merchantId),
          eq(simulatorRefunds.paymentRef, input.paymentRef),
          inArray(simulatorRefunds.status, ["processing", "succeeded"]),
        ),
      );
    if ((reserved?.amount ?? 0) + input.amountMinor > capture.capturedMinor)
      throw new SimulatorError(409, "Refund exceeds remaining captured amount");
    const [control] = await tx
      .select()
      .from(controls)
      .where(and(eq(controls.merchantId, merchantId), eq(controls.paymentRef, input.paymentRef)));
    if (control?.mode === "retry_once" && control.failuresRemaining > 0) {
      await tx
        .update(controls)
        .set({ failuresRemaining: control.failuresRemaining - 1 })
        .where(and(eq(controls.merchantId, merchantId), eq(controls.paymentRef, input.paymentRef)));
      return { kind: "retryable" as const };
    }
    const receipt: ProviderReceipt = {
      id: randomUUID(),
      merchantId,
      ...input,
      status: control?.mode === "reject" ? "failed" : "succeeded",
      failureCode: control?.mode === "reject" ? "refund_rejected" : null,
    };
    const [created] = await tx
      .insert(simulatorRefunds)
      .values({ ...receipt, fingerprint })
      .onConflictDoNothing()
      .returning({ id: simulatorRefunds.id });
    if (!created) throw new SimulatorError(409, "Idempotency key payload conflict");
    if (receipt.status === "succeeded")
      await tx.insert(ledger).values({
        refundId: receipt.id,
        merchantId,
        paymentRef: receipt.paymentRef,
        amountMinor: receipt.amountMinor,
        currency: receipt.currency,
        recordedAt: occurredAt,
      });
    await enqueueEvents(
      tx,
      { ...receipt, status: "processing", failureCode: null },
      occurredAt,
      0,
      1,
    );
    await enqueueEvents(
      tx,
      receipt,
      occurredAt,
      control?.eventDelayMs ?? 0,
      control?.eventCopies ?? 1,
    );
    return {
      kind: "receipt" as const,
      receipt,
      mode: control?.mode ?? "success",
      responseDelayMs: control?.responseDelayMs ?? 0,
      replay: false,
    };
  });
}
