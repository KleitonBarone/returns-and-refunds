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
import { Icon } from "./icon.tsx";
import { Workspace } from "./workspace.tsx";
import { WorkspaceSwitcher } from "./workspace-switcher.tsx";
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
        <div className="header-inner">
          <div className="brand">
            <div className="brand-mark" aria-hidden="true">
              {session.data?.actor?.merchantName[0] ?? "N"}
            </div>
            <div>
              <strong>{session.data?.actor?.merchantName ?? "Northline Supply"}</strong>
              <span>Returns workspace</span>
            </div>
          </div>
          <div className="demo-context">
            <span>
              {browserDemo ? "Browser demo" : "Local demo"} ·{" "}
              {session.data ? date(session.data.demoNow) : "Connecting"}
            </span>
            <span>Fictional orders. No real payments.</span>
          </div>
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
        {session.data && (
          <WorkspaceSwitcher
            actor={session.data.actor}
            personas={session.data.personas}
            pendingId={switchPersona.isPending ? switchPersona.variables : undefined}
            onSwitch={(id) => switchPersona.mutate(id)}
          />
        )}
        {session.isError ? (
          <section className="empty-detail">
            <h1>The workspace is unavailable</h1>
            <p role="alert">{session.error.message}</p>
            <button type="button" onClick={() => session.refetch()}>
              <Icon name={session.isFetching ? "loader" : "refresh"} />
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
              Start as the customer to request a return. Switch to Support, Warehouse, and Finance
              to follow each decision.
            </p>
            <div className="welcome-actions">
              <button
                className="primary"
                type="button"
                disabled={switchPersona.isPending}
                onClick={() => switchPersona.mutate("customer-maya")}
              >
                <Icon
                  name={
                    switchPersona.isPending && switchPersona.variables === "customer-maya"
                      ? "loader"
                      : "shopping-bag"
                  }
                />
                Start a return
              </button>
              {browserDemo && (
                <button
                  type="button"
                  disabled={switchPersona.isPending}
                  onClick={() => switchPersona.mutate("finance-sam")}
                >
                  <Icon
                    name={
                      switchPersona.isPending && switchPersona.variables === "finance-sam"
                        ? "loader"
                        : "search"
                    }
                  />
                  Explore refund recovery
                </button>
              )}
            </div>
            {browserDemo && (
              <p className="demo-journey">
                For a prepared refund recovery case, open <strong>DEMO-UNKNOWN</strong> in Finance.
              </p>
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
