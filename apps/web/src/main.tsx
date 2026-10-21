import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { healthResponse } from "../../../packages/contracts/src/index.ts";
import "./style.css";

function App() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => healthResponse.assert(await (await fetch("/api/health")).json()),
  });
  return (
    <main className="foundation">
      <div className="brand-mark">N</div>
      <p>Northline Supply</p>
      <h1>Every return has a next step.</h1>
      <p>Your workspace for customer requests, warehouse decisions, and refund recovery.</p>
      <p role="status">
        {health.isSuccess
          ? `Local environment ready. Demo clock: ${health.data.demoNow}`
          : health.isError
            ? "API unavailable. Check the local environment."
            : "Connecting to your local environment…"}
      </p>
    </main>
  );
}
const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={new QueryClient()}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
