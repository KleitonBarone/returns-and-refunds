import { useMutation } from "@tanstack/react-query";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { focusConfirmation } from "../focus.ts";
import { Icon } from "../icon.tsx";
import { demo } from "./api.ts";

export default function DemoTools({ onReset }: { onReset: (reset: () => void) => Promise<void> }) {
  const { persistent, notice, paymentOutcome } = useSyncExternalStore(
    demo.subscribe,
    demo.getSnapshot,
  );
  const [confirming, setConfirming] = useState(false);
  const resetButton = useRef<HTMLButtonElement>(null);
  const wasConfirming = useRef(false);
  useEffect(() => {
    if (!confirming && wasConfirming.current) resetButton.current?.focus();
    wasConfirming.current = confirming;
  }, [confirming]);
  const reset = useMutation({
    mutationFn: () => onReset(demo.reset),
    onSuccess: () => setConfirming(false),
  });
  return (
    <section className="browser-demo" aria-label="Browser demo controls">
      <div className="browser-demo-inner">
        <div className="demo-introduction">
          <strong>Interactive browser demo</strong>
          <p>
            Workflow and payments are simulated.{" "}
            {persistent
              ? "Progress is saved in this browser."
              : "Progress lasts for this tab only."}
          </p>
          <a
            href="https://github.com/KleitonBarone/returns-and-refunds"
            target="_blank"
            rel="noreferrer"
            className="icon-link"
          >
            View the full application on GitHub
            <Icon name="external-link" />
          </a>
        </div>
        <div className="demo-controls">
          <label className="demo-payment">
            Simulated payment outcome
            <select
              value={paymentOutcome}
              onChange={(event) => demo.setPaymentOutcome(event.target.value)}
            >
              <option value="success">Normal confirmation</option>
              <option value="lost_response">Response lost, recover by lookup</option>
            </select>
          </label>
          <div>
            {confirming ? (
              <fieldset className="demo-reset" aria-label="Confirm demo reset">
                <legend>Clear your demo progress?</legend>
                <div className="action-buttons">
                  <button
                    type="button"
                    ref={focusConfirmation}
                    disabled={reset.isPending}
                    onClick={() => reset.mutate()}
                  >
                    <Icon name={reset.isPending ? "loader" : "reset"} />
                    Confirm reset
                  </button>
                  <button
                    type="button"
                    disabled={reset.isPending}
                    onClick={() => setConfirming(false)}
                  >
                    <Icon name="x" />
                    Cancel reset
                  </button>
                </div>
              </fieldset>
            ) : (
              <button type="button" ref={resetButton} onClick={() => setConfirming(true)}>
                <Icon name="reset" />
                Reset demo
              </button>
            )}
          </div>
        </div>
        {notice && (
          <p className="demo-storage-notice" role="status">
            {notice}
          </p>
        )}
        {reset.isError && (
          <p className="error" role="alert">
            {reset.error.message}
          </p>
        )}
      </div>
    </section>
  );
}
