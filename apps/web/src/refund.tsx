import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Actor,
  money,
  type ReturnView,
  returnDetailContract,
} from "../../../packages/contracts/src/index.ts";
import { api } from "./api.ts";
import { focusConfirmation, focusDetailHeading } from "./focus.ts";
import { dateTime, refundLabel } from "./format.ts";

const explanations = {
  pending: "The refund is queued. Its amount and items remain reserved.",
  processing: "Waiting for the payment service to confirm the refund.",
  succeeded: "The payment service confirmed this refund. The return is closed.",
  failed:
    "This refund was rejected. It cannot be submitted again; its items remain held for review.",
  unknown:
    "The response was lost. The refund may have succeeded, so its amount and items remain reserved until a status check.",
};
function RecoveryActions({ request }: { request: ReturnView }) {
  const client = useQueryClient();
  const [reason, setReason] = useState("");
  const [confirming, setConfirming] = useState(false);
  const recover = useMutation({
    mutationFn: async (action: "check" | "retry") =>
      returnDetailContract.assert(
        await api(`/returns/${request.id}/refund/${action}`, {
          reason,
          correlationId: crypto.randomUUID(),
        }),
      ),
    onSuccess: async () => {
      setConfirming(false);
      await Promise.all([
        client.invalidateQueries({ queryKey: ["return"] }),
        client.invalidateQueries({ queryKey: ["returns"] }),
      ]);
      focusDetailHeading();
    },
  });
  if (!request.refund || !["unknown", "processing"].includes(request.refund.status)) return null;
  return (
    <div className="refund-recovery">
      <h4>Check the original refund</h4>
      <p>
        Ask the payment service for its current status. The amount and items stay reserved until the
        outcome is confirmed.
      </p>
      <label className="field">
        Recovery reason
        <textarea
          maxLength={500}
          value={reason}
          disabled={recover.isPending}
          placeholder="Record why you are checking this refund."
          onChange={(event) => {
            setReason(event.target.value);
            setConfirming(false);
            recover.reset();
          }}
        />
      </label>
      <div className="action-buttons">
        <button
          type="button"
          disabled={reason.trim().length < 3 || recover.isPending}
          onClick={() => recover.mutate("check")}
        >
          {recover.isPending && recover.variables === "check"
            ? "Checking payment…"
            : "Check payment status"}
        </button>
        {request.refund.status === "unknown" &&
          request.refund.lastLookup === "not_found" &&
          !confirming && (
            <button
              type="button"
              disabled={reason.trim().length < 3 || recover.isPending}
              onClick={() => setConfirming(true)}
            >
              Retry original refund
            </button>
          )}
      </div>
      {confirming && (
        <fieldset className="confirmation" aria-label="Confirm original refund retry">
          <strong>
            Retry the original {money(request.refund.amountMinor, request.refund.currency)} refund?
          </strong>
          <p>The payment service did not find it. This queues the same refund again.</p>
          <div className="action-buttons">
            <button
              type="button"
              className="primary"
              ref={focusConfirmation}
              disabled={reason.trim().length < 3 || recover.isPending}
              onClick={() => recover.mutate("retry")}
            >
              {recover.isPending ? "Queuing original refund…" : "Confirm original refund retry"}
            </button>
            <button
              type="button"
              disabled={recover.isPending}
              onClick={() => {
                setConfirming(false);
                focusDetailHeading();
              }}
            >
              Cancel
            </button>
          </div>
        </fieldset>
      )}
      {recover.isError && (
        <p className="error" role="alert">
          {recover.error.message}
        </p>
      )}
    </div>
  );
}
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
      focusDetailHeading();
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
          {refundLabel(request.refund.status)}
        </span>
        <p>{request.refund.message ?? explanations[request.refund.status]}</p>
        {actor.role === "customer" && request.refund.status === "unknown" && (
          <p>
            Finance will check the original payment. Your items and refund amount remain reserved.
          </p>
        )}
        {request.refund.providerReceiptId && (
          <small>Payment receipt {request.refund.providerReceiptId}</small>
        )}
        {request.refund.checkedAt && (
          <small>Last checked {dateTime(request.refund.checkedAt)}</small>
        )}
        {actor.role === "finance" && (
          <details className="payment-reference">
            <summary>Payment reference</summary>
            <small>Refund operation {request.refund.id}</small>
          </details>
        )}
        {actor.role === "finance" && <RecoveryActions request={request} />}
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
              ref={focusConfirmation}
              disabled={submit.isPending}
              onClick={() => submit.mutate()}
            >
              {submit.isPending
                ? "Queuing refund…"
                : `Confirm ${money(request.amountMinor, request.currency)} refund`}
            </button>
            <button
              type="button"
              disabled={submit.isPending}
              onClick={() => {
                setConfirming(false);
                focusDetailHeading();
              }}
            >
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
