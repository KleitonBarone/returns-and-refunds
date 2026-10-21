import { type } from "arktype";

export const providerStatus = type("'processing' | 'succeeded' | 'failed'");
const refundFields = {
  paymentRef: "0 < string <= 100",
  idempotencyKey: "0 < string <= 100",
  amountMinor: "0 < number.integer <= 2147483647",
  currency: /^[A-Z]{3}$/,
} as const;
export const refundSubmission = type(refundFields).onDeepUndeclaredKey("reject");
export const providerReceipt = type({
  ...refundFields,
  id: "string.uuid",
  merchantId: "string",
  status: providerStatus,
  failureCode: "string | null",
}).onDeepUndeclaredKey("reject");
export type ProviderReceipt = typeof providerReceipt.infer;
export const providerEvent = type({
  id: "string.uuid",
  provider: "'local-simulator'",
  occurredAt: "string.date.iso",
  refund: providerReceipt,
});
export type ProviderEvent = typeof providerEvent.infer;
export const captureInput = type({
  merchantId: "0 < string <= 80",
  paymentRef: "0 < string <= 100",
  capturedMinor: "0 < number.integer <= 2147483647",
  currency: /^[A-Z]{3}$/,
}).onDeepUndeclaredKey("reject");
export const controlInput = type({
  merchantId: "0 < string <= 80",
  paymentRef: "0 < string <= 100",
  mode: "'success' | 'reject' | 'retry_once' | 'drop_response' | 'delay_response'",
  responseDelayMs: "0 <= number.integer <= 5000",
  eventDelayMs: "0 <= number.integer <= 60000",
  eventCopies: "1 <= number.integer <= 3",
}).onDeepUndeclaredKey("reject");
export const enqueueEventInput = type({
  refundId: "string.uuid",
  status: providerStatus,
  delayMs: "0 <= number.integer <= 60000",
  copies: "1 <= number.integer <= 3",
}).onDeepUndeclaredKey("reject");
export const simulatorHealth = type({
  service: "'payment-simulator'",
  runId: "string",
  database: "'ready'",
});
export const simulatorDiagnostics = type({
  runId: "string",
  ledger: type({
    refundId: "string.uuid",
    merchantId: "string",
    paymentRef: "string",
    amountMinor: "number.integer",
    currency: "string",
    recordedAt: "string",
  }).array(),
  refunds: providerReceipt.array(),
  deliveries: type({
    id: "string.uuid",
    eventId: "string.uuid",
    refundId: "string.uuid",
    runAt: "string",
    deliveredAt: "string | null",
    attempts: "number.integer",
    lastStatus: "number.integer | null",
  }).array(),
});
