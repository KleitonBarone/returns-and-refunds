import type { Actor } from "../../../packages/contracts/src/index.ts";
import { Icon, type IconName } from "./icon.tsx";

const workspaces = [
  { id: "customer-maya", label: "Customer", task: "Request a return", icon: "shopping-bag" },
  { id: "support-ava", label: "Support", task: "Review requests", icon: "clipboard-check" },
  { id: "warehouse-jules", label: "Warehouse", task: "Inspect items", icon: "package-check" },
  { id: "finance-sam", label: "Finance", task: "Issue refunds", icon: "credit-card" },
] satisfies { id: string; label: string; task: string; icon: IconName }[];

export function WorkspaceSwitcher({
  actor,
  personas,
  pendingId,
  onSwitch,
}: {
  actor: Actor | null;
  personas: Actor[];
  pendingId: string | undefined;
  onSwitch: (id: string) => void;
}) {
  const additional = personas.filter(
    (persona) => !workspaces.some((step) => step.id === persona.id),
  );
  return (
    <section className="workspace-switcher" aria-labelledby="workspace-switcher-title">
      <div className="switcher-heading">
        <h2 id="workspace-switcher-title">Explore the return workflow</h2>
        <p>Switch workspaces to follow a return from request to refund.</p>
      </div>
      <fieldset className="workspace-choices" aria-label="Choose a workspace">
        {workspaces.map((step) => (
          <button
            key={step.id}
            type="button"
            className="workspace-choice"
            aria-label={`${step.label} workspace`}
            aria-pressed={actor?.id === step.id}
            disabled={Boolean(pendingId) || !personas.some((persona) => persona.id === step.id)}
            onClick={() => onSwitch(step.id)}
          >
            <Icon
              name={pendingId === step.id ? "loader" : actor?.id === step.id ? "check" : step.icon}
            />
            <span>
              <strong>{step.label}</strong>
              <small>{step.task}</small>
            </span>
          </button>
        ))}
      </fieldset>
      <p className="viewing-as" role="status">
        {actor ? (
          <>
            Viewing as <strong>{actor.name}</strong> at {actor.merchantName}.
          </>
        ) : (
          "Start with Customer to request your first return."
        )}
      </p>
      {additional.length > 0 && (
        <details className="additional-scenarios">
          <summary>More demo scenarios</summary>
          <p>Explore a different customer or merchant.</p>
          <label className="scenario-field">
            Additional demo scenario
            <select
              value={additional.some((persona) => persona.id === actor?.id) ? actor?.id : ""}
              aria-disabled={Boolean(pendingId)}
              aria-busy={Boolean(pendingId)}
              onChange={(event) => {
                if (!pendingId) onSwitch(event.target.value);
              }}
            >
              <option value="" disabled>
                Choose a scenario
              </option>
              {additional.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name}, {persona.role} at {persona.merchantName}
                </option>
              ))}
            </select>
          </label>
        </details>
      )}
    </section>
  );
}
