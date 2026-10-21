import { type } from "arktype";

export const healthResponse = type({
  service: "'returns-api'",
  runId: "string",
  database: "'ready'",
  demoNow: "string",
});

export const DEMO_NOW = "2026-10-01T12:00:00.000Z";

export const roles = ["customer", "support", "warehouse", "finance"] as const;
export const returnStates = [
  "requested",
  "approved",
  "received",
  "inspection_passed",
  "inspection_failed",
  "closed",
] as const;
export const actorContract = type({
  id: "string",
  name: "string",
  merchantId: "string",
  merchantName: "string",
  role: type.enumerated(...roles),
  customerId: "string | null",
});
export type Actor = typeof actorContract.infer;
export const sessionContract = type({
  actor: actorContract.or("null"),
  personas: actorContract.array(),
  demoNow: "string",
});
export const sessionInput = type({ personaId: "0 < string <= 80" }).onDeepUndeclaredKey("reject");
export const requestInput = type({
  orderId: "0 < string <= 80",
  requestKey: "string.uuid",
  reason: "3 <= string <= 500",
  items: type({ lineId: "0 < string <= 100", quantity: "0 < number.integer <= 50" }).array(),
}).onDeepUndeclaredKey("reject");
export const orderContract = type({
  id: "string",
  number: "string",
  currency: "string",
  capturedMinor: "number",
  deliveredAt: "string",
  deadline: "string",
  eligible: "boolean",
  lines: type({
    id: "string",
    name: "string",
    variant: "string",
    quantity: "number",
    available: "number",
    unitValues: "number[]",
  }).array(),
});
export const ordersContract = orderContract.array();
export type OrderView = typeof orderContract.infer;
export const returnSummaryContract = type({
  id: "string",
  orderId: "string",
  orderNumber: "string",
  customerName: "string",
  reason: "string",
  status: type.enumerated(...returnStates),
  amountMinor: "number",
  currency: "string",
  requestedAt: "string",
  deadline: "string",
  policyVersion: "string",
});
export const returnsContract = returnSummaryContract.array();
export const returnDetailContract = returnSummaryContract.and({
  items: type({
    unitId: "string",
    name: "string",
    variant: "string",
    amountMinor: "number",
  }).array(),
  history: type({
    id: "string",
    actorName: "string",
    event: "string",
    reason: "string",
    at: "string",
    fromStatus: "string | null",
    toStatus: "string",
  }).array(),
});
export type ReturnView = typeof returnDetailContract.infer;

export function money(minor: number, currency = "USD") {
  if (!Number.isSafeInteger(minor)) throw new Error("Money must be an integer in minor units");
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(minor / 100);
}
