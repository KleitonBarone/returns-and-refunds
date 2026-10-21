import { createHash } from "node:crypto";
import { type } from "arktype";
import {
  type ProviderReceipt,
  providerReceipt,
  type refundSubmission,
} from "../../../packages/contracts/src/payment.ts";

export type RefundPayload = typeof refundSubmission.infer & { merchantId: string };
export type SubmissionOutcome =
  | { kind: "receipt"; receipt: ProviderReceipt }
  | { kind: "retryable"; message: string }
  | { kind: "unknown"; message: string };
export type LookupOutcome =
  | { kind: "receipt"; receipt: ProviderReceipt }
  | { kind: "not_found" }
  | { kind: "unavailable"; message: string };
export type PaymentProvider = {
  submit: (payload: RefundPayload) => Promise<SubmissionOutcome>;
  lookup: (payload: RefundPayload) => Promise<LookupOutcome>;
};
const providerConfig = type({
  url: "string.url",
  token: "string >= 32",
  timeoutMs: "10 <= number.integer <= 5000",
});
const retryableResponse = type({ retryable: "true" });
export function readProviderConfig(env: NodeJS.ProcessEnv = process.env) {
  const config = providerConfig.assert({
    url: env.SIMULATOR_URL,
    token: env.SIMULATOR_API_TOKEN,
    timeoutMs: Number(env.PROVIDER_TIMEOUT_MS ?? 750),
  });
  const address = new URL(config.url);
  if (
    address.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(address.hostname)
  )
    throw new Error("The local provider requires loopback HTTP");
  return config;
}
export function payloadFingerprint(payload: RefundPayload) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        merchantId: payload.merchantId,
        paymentRef: payload.paymentRef,
        idempotencyKey: payload.idempotencyKey,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
      }),
    )
    .digest("hex");
}
export function receiptMatches(payload: RefundPayload, receipt: ProviderReceipt) {
  return (
    receipt.merchantId === payload.merchantId &&
    receipt.paymentRef === payload.paymentRef &&
    receipt.idempotencyKey === payload.idempotencyKey &&
    receipt.amountMinor === payload.amountMinor &&
    receipt.currency === payload.currency
  );
}
export function createPaymentProvider(config = readProviderConfig()): PaymentProvider {
  return {
    lookup: async (payload) => {
      try {
        const response = await fetch(
          `${config.url}/v1/merchants/${encodeURIComponent(payload.merchantId)}/refunds/${encodeURIComponent(payload.idempotencyKey)}`,
          {
            headers: { authorization: `Bearer ${config.token}` },
            signal: AbortSignal.timeout(config.timeoutMs),
            redirect: "error",
          },
        );
        if (response.status === 404) return { kind: "not_found" };
        const receipt = providerReceipt(await response.json());
        if (response.ok && !(receipt instanceof type.errors) && receiptMatches(payload, receipt))
          return { kind: "receipt", receipt };
      } catch {
        // An unavailable lookup cannot establish whether a financial write occurred.
      }
      return {
        kind: "unavailable",
        message: "The payment status could not be verified. The original refund remains reserved.",
      };
    },
    submit: async (payload) => {
      try {
        const { merchantId, ...body } = payload;
        const response = await fetch(
          `${config.url}/v1/merchants/${encodeURIComponent(merchantId)}/refunds`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${config.token}`,
              "content-type": "application/json",
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(config.timeoutMs),
            redirect: "error",
          },
        );
        const result: unknown = await response.json();
        if (response.status === 503 && retryableResponse.allows(result))
          return {
            kind: "retryable",
            message:
              "The payment service rejected this attempt before writing the refund. The same refund will retry.",
          };
        const receipt = providerReceipt(result);
        if (!response.ok || receipt instanceof type.errors || !receiptMatches(payload, receipt))
          return {
            kind: "unknown",
            message: "The payment service did not provide a matching refund confirmation.",
          };
        return { kind: "receipt", receipt };
      } catch {
        return {
          kind: "unknown",
          message:
            "The payment response was lost or timed out. The refund still needs a status check.",
        };
      }
    },
  };
}
