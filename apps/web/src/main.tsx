import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { lazy, StrictMode, Suspense, useState } from "react";
import { createRoot } from "react-dom/client";
import { sessionContract } from "../../../packages/contracts/src/index.ts";
import { api } from "./api.ts";
import { date } from "./format.ts";
import { Workspace } from "./workspace.tsx";
import "./style.css";

const browserDemo = import.meta.env.MODE === "demo";
const DemoTools = browserDemo ? lazy(() => import("./demo/tools.tsx")) : null;

function App() {
  const client = useQueryClient();
  const [demoVersion, setDemoVersion] = useState(0);
  const session = useQuery({
    queryKey: ["session"],
    queryFn: async () => sessionContract.assert(await api("/session")),
    retry: 1,
  });
  const switchPersona = useMutation({
    mutationFn: async (personaId: string) =>
      sessionContract.assert(await api("/session", { personaId })),
    onSuccess: async (result) => {
      await client.cancelQueries();
      client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
      client.setQueryData(["session"], result);
    },
  });
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to workspace
      </a>
      <header className="app-header">
        <div className="brand">
          <div className="brand-mark" aria-hidden="true">
            {session.data?.actor?.merchantName[0] ?? "N"}
          </div>
          <div>
            <strong>{session.data?.actor?.merchantName ?? "Northline Supply"}</strong>
            <span>Returns workspace</span>
          </div>
        </div>
        <div className="demo-tools">
          <span className="demo-clock">
            {browserDemo ? "Browser demo" : "Local demo"} ·{" "}
            {session.data ? date(session.data.demoNow) : "Connecting"}
          </span>
          <span className="demo-disclosure">Synthetic orders. No real payments.</span>
          <label>
            Demo persona
            <select
              value={session.data?.actor?.id ?? ""}
              aria-disabled={switchPersona.isPending}
              aria-busy={switchPersona.isPending}
              onChange={(event) => {
                if (!switchPersona.isPending) switchPersona.mutate(event.target.value);
              }}
            >
              <option value="" disabled>
                Choose a persona
              </option>
              {session.data?.personas.map((persona) => (
                <option key={persona.id} value={persona.id}>
                  {persona.name} ({persona.role}
                  {persona.merchantId === "northline" ? "" : ", other merchant"})
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>
      {DemoTools && (
        <Suspense fallback={null}>
          <DemoTools
            onReset={async (reset) => {
              await client.cancelQueries();
              reset();
              client.removeQueries({ predicate: (query) => query.queryKey[0] !== "session" });
              client.setQueryData(["session"], sessionContract.assert(await api("/session")));
              switchPersona.reset();
              setDemoVersion((version) => version + 1);
            }}
          />
        </Suspense>
      )}
      <main id="main" className="app-main" tabIndex={-1}>
        {session.isError ? (
          <section className="empty-detail">
            <h1>The workspace is unavailable</h1>
            <p role="alert">{session.error.message}</p>
            <button type="button" onClick={() => session.refetch()}>
              Try again
            </button>
          </section>
        ) : session.isPending ? (
          <p role="status">Connecting to the workspace…</p>
        ) : session.data.actor ? (
          <Workspace key={`${session.data.actor.id}-${demoVersion}`} actor={session.data.actor} />
        ) : (
          <section className="welcome">
            <span className="status status-open">
              {browserDemo
                ? "Fictional merchant, simulated workflow"
                : "Fictional merchant, real workflow"}
            </span>
            <h1>
              Follow a return.
              <br />
              Understand every decision.
            </h1>
            <p>
              Choose Maya to request a return, then switch to the support, warehouse, and finance
              teams to follow its progress.
            </p>
            <button
              className="primary"
              type="button"
              onClick={() => switchPersona.mutate("customer-maya")}
            >
              Open Maya's orders
            </button>
            {browserDemo && (
              <>
                <button
                  className="recovery-shortcut"
                  type="button"
                  onClick={() => switchPersona.mutate("finance-sam")}
                >
                  Explore refund recovery
                </button>
                <p className="demo-journey">
                  Start with Maya, then choose Ava for approval, Jules for inspection, and Sam for
                  the refund. For a prepared lost-response case, open Sam's{" "}
                  <strong>DEMO-UNKNOWN</strong> return.
                </p>
              </>
            )}
            <p className="muted small">
              {browserDemo
                ? "All demo data stays on your device. No real payments."
                : "Synthetic data. Local services. No real payments."}
            </p>
          </section>
        )}
        {switchPersona.isError && (
          <p className="error" role="alert">
            {switchPersona.error.message}
          </p>
        )}
      </main>
    </>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: browserDemo
            ? { queries: { networkMode: "always" }, mutations: { networkMode: "always" } }
            : undefined,
        })
      }
    >
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
