import { createHmac, randomUUID } from "node:crypto";
import { and, asc, eq, isNull, lte, or } from "drizzle-orm";
import type { ProviderEvent, ProviderReceipt } from "../../../packages/contracts/src/payment.ts";
import type { readSimulatorConfig } from "./config.ts";
import type { SimulatorDatabase, SimulatorTransaction } from "./db.ts";
import { deliveries } from "./schema.ts";

export async function enqueueEvents(
  tx: SimulatorTransaction,
  receipt: ProviderReceipt,
  occurredAt: string,
  delayMs: number,
  copies: number,
) {
  const payload: ProviderEvent = {
    id: randomUUID(),
    provider: "local-simulator",
    occurredAt,
    refund: receipt,
  };
  await tx.insert(deliveries).values(
    Array.from({ length: copies }, () => ({
      id: randomUUID(),
      eventId: payload.id,
      refundId: receipt.id,
      payload,
      runAt: new Date(Date.now() + delayMs).toISOString(),
    })),
  );
  return payload.id;
}
export function eventHeaders(raw: string, secret: string, now = Date.now()) {
  const timestamp = String(Math.floor(now / 1000));
  return {
    "content-type": "application/json",
    "x-simulator-timestamp": timestamp,
    "x-simulator-signature": createHmac("sha256", secret)
      .update(`${timestamp}.${raw}`)
      .digest("hex"),
  };
}
// Claim before HTTP and fence completion so an expired sender cannot overwrite its successor.
export async function deliverNext(
  db: SimulatorDatabase,
  config: ReturnType<typeof readSimulatorConfig>,
  options: { now?: number; refundId?: string } = {},
) {
  const now = options.now ?? Date.now();
  const instant = new Date(now).toISOString();
  const claimed = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(deliveries)
      .where(
        and(
          isNull(deliveries.deliveredAt),
          lte(deliveries.runAt, instant),
          or(isNull(deliveries.leaseUntil), lte(deliveries.leaseUntil, instant)),
          options.refundId ? eq(deliveries.refundId, options.refundId) : undefined,
        ),
      )
      .orderBy(asc(deliveries.runAt), asc(deliveries.id))
      .limit(1)
      .for("update", { skipLocked: true });
    if (!job) return null;
    const token = randomUUID();
    await tx
      .update(deliveries)
      .set({
        leaseToken: token,
        leaseUntil: new Date(now + 2000).toISOString(),
        attempts: job.attempts + 1,
      })
      .where(eq(deliveries.id, job.id));
    return { ...job, token };
  });
  if (!claimed) return null;
  const raw = JSON.stringify(claimed.payload);
  let status = 0;
  try {
    const response = await fetch(config.webhookUrl, {
      method: "POST",
      headers: eventHeaders(raw, config.signingSecret),
      body: raw,
      signal: AbortSignal.timeout(750),
      redirect: "error",
    });
    status = response.status;
    await response.body?.cancel();
  } catch {
    /* The persisted delivery remains retryable after transport failure. */
  }
  const delivered = status >= 200 && status < 300;
  const [completed] = await db
    .update(deliveries)
    .set({
      deliveredAt: delivered ? new Date().toISOString() : null,
      leaseToken: null,
      leaseUntil: null,
      lastStatus: status,
      runAt: new Date(
        now + Math.min(30000, 1000 * 2 ** Math.min(claimed.attempts, 5)),
      ).toISOString(),
    })
    .where(and(eq(deliveries.id, claimed.id), eq(deliveries.leaseToken, claimed.token)))
    .returning({ id: deliveries.id });
  return { id: claimed.id, eventId: claimed.eventId, delivered, fenced: !completed };
}
export async function deliverBatch(
  db: SimulatorDatabase,
  config: ReturnType<typeof readSimulatorConfig>,
  refundId?: string,
) {
  const results = [];
  for (let index = 0; index < 10; index++) {
    const result = await deliverNext(db, config, { refundId });
    if (!result) break;
    results.push(result);
  }
  return results;
}
