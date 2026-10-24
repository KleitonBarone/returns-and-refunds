# Returns and refunds

A local return and refund application for a fictional clothing merchant. Customers
request part of an order; support approves it, the warehouse records inspection,
and finance confirms the refund. The interesting case is a successful payment
whose response disappears: the app must recover the original refund without
issuing another one.

[Follow the screenshot walkthrough](docs/walkthrough.md)
or [read the recovery case study](docs/case-study.md).

![Finance confirms the original partial refund after recovery](docs/evidence/screenshots/05-refund-recovered.png)

## Try it locally

Use **Node 24.20.0**, **pnpm 11.23.0**, and Docker Engine with Compose. On Windows,
the application runs with Windows Node/pnpm and Docker runs in WSL Ubuntu using
its default Unix socket. Docker Desktop is unnecessary. Linux uses native Docker.
Allow at least 2 GiB free disk space. No external account or payment credentials
are needed.

```sh
pnpm install --frozen-lockfile
pnpm env:doctor
pnpm demo:run
```

Open the printed loopback URL. Setup creates separate application and simulator
databases, applies migrations, seeds scenarios, and starts the real services on
assigned ports. Choose Sam and open `DEMO-UNKNOWN`, add a recovery reason, then
choose **Check payment status**. Maya sees the same history and remaining units.
Ava handles support; Jules handles receipt and inspection. Noah and Robin belong
to a separate merchant.

The fixture clock is October 1, 2026. Cases include normal and partial refunds,
expiry, failed inspection, a pre-write retry, an unknown result, previously
returned units, and merchant isolation. All orders and payments are synthetic.

Ctrl+C stops this disposable demo and removes its databases. To rebuild its
scenarios while it runs, use `pnpm demo:reset <printed-run-id>` in another terminal,
then reload the browser. Reset verifies both database identities and demo-only
markers. The [scenario guide](docs/repeatable-demo.md) explains its exact scope.

For progress that survives shutdown, use `pnpm dev` and open
`http://127.0.0.1:4320`. Ctrl+C or `pnpm dev:down` stops its services while retaining
both development volumes. `.env.example` lists optional port and clock overrides.
`pnpm env:doctor --dev` checks those configured ports; the default doctor allows assigned ports.
Startup creates missing fixtures and preserves existing returns.

## Verify it

```sh
pnpm check
pnpm test
pnpm build
pnpm test:integration
pnpm test:environment
pnpm browser:install
pnpm test:e2e
pnpm test:e2e:environment
pnpm demo:verify
```

Run the lifecycle suites sequentially. They create fresh paired databases and
verify cleanup after successful, failed, and interrupted execution. Integration
checks cover authorization, competing reservations, capture limits, atomic audits,
worker leases, and signed-event races. Browser journeys complete the workflow
through the real UI, restart services, and compare the independent provider ledger.
`demo:verify` compares two scenario cycles and checks reset refusals and partial
commit failure. [Recorded evidence](docs/evidence/repeatable-verification.md)
contains actual IDs and amounts.

## How it works

React, Vite, Tailwind, and TanStack Query provide the interface. Fastify, ArkType,
Drizzle, and PostgreSQL enforce the workflow. A PostgreSQL outbox avoids adding a
broker. A separate HTTP payment simulator owns its persistent ledger; the app
cannot access its SQL database. Integer minor-unit amounts, purchased-unit claims,
and order locks protect partial refunds. Unknown outcomes retain their reservation
until an authoritative lookup or signed event resolves the original refund.

See the [architecture](docs/architecture.md), [refund processing](docs/refund-processing.md),
[recovery contract](docs/refund-recovery.md), and [simulator limits](docs/payment-simulator.md).
The [handoff](HANDOFF.md) covers screenshot capture, clean-checkout verification, environment
recovery, and retained disk usage.

This is portfolio software with local persona sessions. It has no production
authentication, real payment adapter, shipping integration, or public deployment.
Terminally rejected refunds conservatively retain capacity; this demo has no
manual-resolution workflow. Simulator verification makes no claim about a real
provider's settlement, retention, or idempotency contract.

Released under the [MIT license](LICENSE).
