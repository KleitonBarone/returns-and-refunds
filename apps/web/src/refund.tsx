import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Actor,
  money,
  type ReturnView,
  returnDetailContract,
} from "../../../packages/contracts/src/index.ts";
import { api } from "./api.ts";

const explanations = {
  pending: "The refund is queued. Its amount and items remain reserved.",
  processing: "Waiting for the payment service to confirm the refund.",
  succeeded: "The payment service confirmed this refund. The return is closed.",
  failed:
    "This refund was rejected. It cannot be submitted again; its items remain held for review.",
  unknown:
    "The response was lost. The refund may have succeeded, so its amount and items remain reserved until a status check.",
};
export function RefundPanel({ actor, request }: { actor: Actor; request: ReturnView }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const submit = useMutation({
    mutationFn: async () =>
      returnDetailContract.assert(
        await api(`/returns/${request.id}/refund`, {
          expectedAmountMinor: request.amountMinor,
          reason,
          correlationId: crypto.randomUUID(),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["return"] }),
        client.invalidateQueries({ queryKey: ["returns"] }),
      ]);
    },
  });
  if (request.refund)
    return (
      <section
        className={`refund-panel refund-${request.refund.status}`}
        aria-label="Refund status"
        aria-live="polite"
      >
        <div className="amount-line">
          <h3>Refund</h3>
          <strong>{money(request.refund.amountMinor, request.refund.currency)}</strong>
        </div>
        <span className={`status status-refund-${request.refund.status}`}>
          {request.refund.status === "unknown" ? "Outcome unknown" : request.refund.status}
        </span>
        <p>{explanations[request.refund.status]}</p>
        {request.refund.message && <p>{request.refund.message}</p>}
        {request.refund.providerReceiptId && (
          <small>Payment receipt {request.refund.providerReceiptId}</small>
        )}
      </section>
    );
  if (actor.role !== "finance" || request.status !== "inspection_passed") return null;
  return (
    <section className="action-panel" aria-labelledby="refund-title">
      <h3 id="refund-title">Issue refund</h3>
      <p>
        Refund {money(request.amountMinor, request.currency)} in merchandise value to the original
        payment.
      </p>
      <label className="field">
        Refund reason
        <textarea
          maxLength={500}
          value={reason}
          disabled={submit.isPending}
          placeholder="Record why this refund is ready."
          onChange={(event) => {
            setReason(event.target.value);
            setConfirming(false);
            submit.reset();
          }}
        />
      </label>
      {confirming ? (
        <fieldset className="confirmation" aria-label="Confirm refund">
          <strong>
            Confirm {money(request.amountMinor, request.currency)} refund for {request.orderNumber}?
          </strong>
          <p>{reason.trim()}</p>
          <p>This sends a refund to the local payment simulator. No real money moves.</p>
          <div className="action-buttons">
            <button
              type="button"
              className="primary"
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending
                ? "Queuing refund…"
                : `Confirm ${money(request.amountMinor, request.currency)} refund`}
            </button>
            <button type="button" disabled={submit.isPending} onClick={() => setConfirming(false)}>
              Cancel
            </button>
          </div>
        </fieldset>
      ) : (
        <button
          type="button"
          className="primary"
          disabled={reason.trim().length < 3 || submit.isPending}
          onClick={() => setConfirming(true)}
        >
          Review refund
        </button>
      )}
      {submit.isError && (
        <p className="error" role="alert">
          {submit.error.message}
        </p>
      )}
    </section>
  );
}
