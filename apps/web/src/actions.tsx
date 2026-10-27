import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import {
  type Actor,
  type ReturnView,
  returnActions,
  returnDetailContract,
} from "../../../packages/contracts/src/index.ts";
import { api } from "./api.ts";
import { focusConfirmation, focusDetailHeading } from "./focus.ts";
import { Icon, type IconName } from "./icon.tsx";

const actionIcons = {
  approve: "check",
  reject: "x",
  receive: "package-check",
  pass_inspection: "clipboard-check",
  fail_inspection: "clipboard-x",
} satisfies Record<(typeof returnActions)[number]["name"], IconName>;

export function ReturnActions({ actor, request }: { actor: Actor; request: ReturnView }) {
  const client = useQueryClient();
  const available = returnActions.filter(
    (action) => action.role === actor.role && action.from === request.status,
  );
  const [reason, setReason] = useState("");
  const [action, setAction] = useState<(typeof returnActions)[number]["name"] | null>(null);
  const selected = available.find((item) => item.name === action);
  const decision = useMutation({
    mutationFn: async () =>
      returnDetailContract.assert(
        await api(`/returns/${request.id}/actions`, {
          action,
          reason,
          expectedStatus: request.status,
          correlationId: crypto.randomUUID(),
        }),
      ),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ["return"] }),
        client.invalidateQueries({ queryKey: ["returns"] }),
        client.invalidateQueries({ queryKey: ["orders"] }),
      ]);
      focusDetailHeading();
    },
  });
  if (!available.length) return null;
  return (
    <section className="action-panel" aria-labelledby="actions-title">
      <h3 id="actions-title">Next action</h3>
      <label className="field">
        Decision reason
        <textarea
          value={reason}
          maxLength={500}
          disabled={decision.isPending}
          onChange={(event) => {
            setReason(event.target.value);
            setAction(null);
            decision.reset();
          }}
          placeholder="Record what you checked and why."
        />
      </label>
      <p className="muted small">Your name and reason will be visible in the customer's history.</p>
      {selected ? (
        <fieldset className="confirmation" aria-label="Confirm return action">
          <strong>
            {selected.label} for {request.orderNumber}?
          </strong>
          <p>{reason.trim()}</p>
          {(action === "reject" || action === "fail_inspection") && (
            <p>
              This closes the return and releases its reserved items. The decision stays in its
              history.
            </p>
          )}
          <div className="action-buttons">
            <button
              className="primary"
              ref={focusConfirmation}
              type="button"
              disabled={decision.isPending}
              onClick={() => decision.mutate()}
            >
              <Icon name={decision.isPending ? "loader" : actionIcons[selected.name]} />
              {decision.isPending ? "Saving decision…" : `Confirm ${selected.label.toLowerCase()}`}
            </button>
            <button
              type="button"
              disabled={decision.isPending}
              onClick={() => {
                setAction(null);
                focusDetailHeading();
              }}
            >
              <Icon name="x" />
              Cancel
            </button>
          </div>
        </fieldset>
      ) : (
        <div className="action-buttons">
          {available.map((item) => (
            <button
              type="button"
              key={item.name}
              className={
                item.name === "reject" || item.name === "fail_inspection"
                  ? "danger-secondary"
                  : "primary"
              }
              disabled={reason.trim().length < 3 || decision.isPending}
              onClick={() => {
                decision.reset();
                setAction(item.name);
              }}
            >
              <Icon name={actionIcons[item.name]} />
              {item.label}
            </button>
          ))}
        </div>
      )}
      {decision.isError && (
        <div className="error" role="alert">
          <p>{decision.error.message}</p>
          <button type="button" onClick={() => client.invalidateQueries({ queryKey: ["return"] })}>
            <Icon name="refresh" />
            Refresh return
          </button>
        </div>
      )}
    </section>
  );
}
