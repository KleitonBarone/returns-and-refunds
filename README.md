# Returns and refunds

A local operations console for reviewing return requests, recording warehouse
inspection, and issuing refunds. The customer can follow the request while the
merchant can explain each decision and track an uncertain refund.

The default environment uses fictional orders and a local payment simulator.
No merchant account, real customer, card, or movement of money is required.

**Status: requests, decisions, inspection, and refund submission implemented.** Choose a demo
persona, request part of an eligible order, and follow approval, receipt, and
inspection in the merchant queue. Each transition records its actor and reason.
Rejected requests and failed inspections release their reserved units atomically.
Finance confirms the amount; a durable worker processes the original operation.
Unknown outcomes keep their amount and items reserved. Recovery and signed event
consumption follow in the remaining
[delivery plan](PLAN.md). The [thread starter](THREAD_START.md) explains resuming
from the next incomplete delivery PR.

The [persistent payment simulator](docs/payment-simulator.md) is available as a
separate HTTP service and database. It supports idempotent refunds, an independent
ledger, failure controls, and durable signed events. The
[refund worker](docs/refund-processing.md) handles leases, pre-write retries,
crashes, and atomic success. The event consumer is the next delivery.

Open Maya's orders to request a return, then choose Ava to see it in support's
queue. Approve it with a reason, then choose Jules to record receipt and inspection.
A passing inspection makes the return ready for Sam's finance review and amount
confirmation. Confirmed success closes it and permanently consumes the refunded
units. Maya's older
order shows the expired window. Robin's queue belongs to
the separate Other Store merchant. Persona switching is a local demo feature,
not production authentication.

The plan also defines reproducible local and end-to-end test environments,
readiness checks, deterministic fixtures, and cleanup after success or failure.
Temporary test resources are disposable; normal shutdown preserves demo data.
Logs and browser artifacts have bounded retention to prevent disk buildup.

The planned demo follows a partial return through approval, warehouse receipt,
and a refund whose successful response is lost. Retrying the operation must keep
one refund in the simulator's ledger. Other seeded cases cover an expired return
window, a rejected inspection, and a duplicate payment event.

The starting architecture is React, TypeScript, Vite, Tailwind, TanStack Query,
a Node.js API and worker, and PostgreSQL. External providers stay behind a small
adapter. An optional Stripe test integration can be considered after the local
workflow works; it is not needed for the portfolio demonstration.

Verification will document author-performed scenarios, financial invariants, and
failure recovery. Any case study will distinguish simulator evidence from actual
provider behavior and customer outcomes.

The final handoff includes a repeatable local demonstration, screenshots, an
English walkthrough, and a case study. Public hosting is optional future work.

## Run locally

Use Node 24.20.0 in the 24.x line and pnpm 11.23.0. On Windows, Docker Engine and
Compose run in WSL Ubuntu; Windows Node/pnpm run the application. No Docker
Desktop install or Docker context changes are needed. Linux CI runs the same
scripts with native Docker. Allow at least 2 GiB free disk space.

```sh
pnpm install --frozen-lockfile
pnpm env:doctor
pnpm dev
```

The runner waits for PostgreSQL, applies migrations, and creates missing demo
fixtures, and verifies the refund worker's identity and heartbeat. It never resets
existing progress on startup. Open
`http://127.0.0.1:4320`; API readiness is at `http://127.0.0.1:4321/api/health`.
The app database uses 55432; the simulator uses HTTP 4322 and its database 55433.
Copy `.env.example` to `.env` to override local ports or the explicitly fictional
clock. The runner generates local database
credentials and ignores an inherited `DATABASE_URL` when creating its environment.
The runner holds a tracked WSL session while services run, so Ubuntu's idle
shutdown cannot silently stop PostgreSQL. Teardown releases that session last;
it does not change WSL configuration.

Stop with Ctrl+C or run `pnpm dev:down` in another terminal. Normal shutdown
removes project processes, containers, and networks while preserving its named
demo volumes. No services need to remain running between development sessions.

While development is running, `pnpm simulator:inspect` shows the synthetic ledger.
Use `pnpm simulator:control payment-order-1042 drop_response` to lose the next new
refund's response, or replace `drop_response` with `success` to restore normal
responses. These commands verify the active checkout and hide local credentials.

## Verify and clean up

```sh
pnpm check
pnpm test
pnpm build
pnpm test:integration
pnpm test:environment
```

Integration runs create separate app/simulator PostgreSQL instances and fixtures,
and start the real simulator HTTP service. Environment verification exercises two
fresh startups, persisted changes across migration/seed reruns, simulator process
restart persistence, a real worker crash after provider success and subsequent
same-operation recovery, real HTTP/worker readiness, injected startup failure, abrupt
termination, and abandoned-run recovery. All disposable containers, networks,
volumes, and child processes must be gone afterward. Each PostgreSQL service is
limited to 512 MiB, one CPU, and 30 connections; application pools use four.

Inspect an abandoned run with `pnpm env:clean <run-id>`, then add `--apply` to
remove its verified resources. `pnpm env:clean --all --apply` handles recorded
inactive runs for this checkout. Active or mismatched resources are refused.
Manifests live under ignored `.local/runs`; the latest result and bounded failure
diagnostics live under `.local`. Persistent demo volumes and shared caches are
preserved. Never use global Docker pruning for this project.

Docker subnet selection checks existing container networks and host routes,
excluding default routes. This also works when existing projects exhaust Docker's
automatic pools. It does not remove or modify their networks. The pinned
PostgreSQL image is reused between runs and is an intentional local dependency.
