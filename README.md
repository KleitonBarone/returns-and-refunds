# Returns and refunds

A return and refund workspace for a fictional clothing merchant. Customers
request part of an order; support approves it, the warehouse records inspection,
and finance confirms the refund. The interesting case is a successful payment
whose response disappears: the app must recover the original refund without
issuing another one.

[Follow the screenshot walkthrough](docs/walkthrough.md)
or [read the recovery case study](docs/case-study.md).

![Finance confirms the original partial refund after recovery](docs/evidence/screenshots/05-refund-recovered.png)

## Try the browser demo

Use **Node 24.20.0** and **pnpm 11.23.0**:

```sh
pnpm install --frozen-lockfile
pnpm dev:demo
```

Open the printed URL. Choose **Customer** to request a return, **Support** for
approval, **Warehouse** for inspection, and **Finance** for the refund. Each
workspace explains its task. **More demo scenarios** contains the extra customers
and merchant. **Explore refund recovery** opens a prepared lost-response case.
The payment-outcome selector controls new simulated refunds. All orders and
payments are fictional.

This mode runs entirely in the browser and saves progress in localStorage. Each
visitor has independent data and a reset button. No Docker, API server, hosted
database, Blob storage, or credentials are needed. If storage is unavailable,
progress lasts only for the current tab.

Run `pnpm build:demo` to create `dist/demo`. The checked-in Vercel configuration
deploys this static version. The [browser demo guide](docs/browser-demo.md) includes
the delivery plan, verification, and exact Vercel import settings.

## Run the full application

The complete backend uses Docker Engine with Compose. Windows runs Node/pnpm
natively and Docker in WSL Ubuntu through its default Unix socket; Docker Desktop
is unnecessary. Linux uses native Docker. Allow at least 2 GiB free disk space.

```sh
pnpm env:doctor
pnpm demo:run
```

This starts real services on assigned loopback ports, with separate application
and payment-simulator databases, migrations, and seeded scenarios. In Finance, open
`DEMO-UNKNOWN`, record a reason, and choose **Check payment status**. Maya sees
the same history and remaining units. The fixture clock is October 1, 2026.

Ctrl+C removes this disposable environment. `pnpm demo:reset <printed-run-id>`
rebuilds its scenarios while running. The [scenario guide](docs/repeatable-demo.md)
explains reset scope, failure cases, and merchant isolation.

For retained progress, use `pnpm dev` at `http://127.0.0.1:4320`. Ctrl+C or
`pnpm dev:down` keeps both development volumes. Startup preserves existing returns.
`.env.example` lists optional ports and clock settings; `pnpm env:doctor --dev`
checks configured ports. The [development guide](docs/development.md) covers
inspection, migrations, screenshots, and scoped cleanup.

## Verify it

```sh
pnpm check
pnpm test
pnpm browser:install
pnpm test:demo
pnpm build
pnpm test:integration
pnpm test:environment
pnpm test:e2e
pnpm test:e2e:environment
pnpm demo:verify
```

Static browser journeys verify the demo without API calls. Full-stack checks use
fresh paired databases, real HTTP services, financial assertions, and service
restarts. Run lifecycle suites sequentially; they verify teardown after success,
failure, and interruption. CI runs both modes.

## How it works

React, Vite, Tailwind, and TanStack Query share the interface across both modes.
The full app uses Fastify, ArkType, Drizzle, and PostgreSQL. Purchased-unit claims,
integer amounts, order locks, and a transactional outbox protect partial refunds.
A separate HTTP simulator owns an independent persistent payment ledger.

The [architecture](docs/architecture.md), [processing](docs/refund-processing.md),
[recovery contract](docs/refund-recovery.md), and [simulator contract](docs/payment-simulator.md)
explain those guarantees. The browser demo simulates their visible workflow;
the full implementation and tests demonstrate database and worker behavior.

This portfolio has no production authentication, real payment adapter, shipping
integration, or manual resolution for terminally rejected refunds. Simulator
verification makes no claim about a real provider's settlement or idempotency
contract. Deployment is left to the repository owner.

Released under the [MIT license](LICENSE).
