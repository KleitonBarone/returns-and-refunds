# Browser demo and Vercel delivery

## Run the static demo

Use Node 24.20.0 and pnpm 11.23.0. No Docker or environment variables are needed.

```sh
pnpm install --frozen-lockfile
pnpm dev:demo
```

Open the printed URL. Start with Maya's `NL-1042` order, then switch to Ava for
approval, Jules for receipt and inspection, and Sam for the refund. The payment
outcome selector affects newly submitted refunds. Choose a lost response to
practice checking the original operation. **Explore refund recovery** opens Sam's
workspace with a prepared `DEMO-UNKNOWN` case.

The business clock stays at October 1, 2026. Browser mode uses the same forms,
contracts, query views, confirmations, and histories as the full application.
Its separate browser adapter simulates the workflow without fetching `/api`.

Progress uses the versioned `returns-and-refunds.browser-demo` localStorage key
on the current origin. Reset asks for confirmation and changes only that key and
the demo's query state. Other sites and browsers have independent progress.
Malformed or incompatible snapshots start fresh with an explanation. Blocked or
full storage falls back to memory, with a visible notice that a reload loses new
progress. Clearing browser data also clears the demo. This is a workflow simulation,
not an authentication or transaction-security boundary.

## Deploy on Vercel

Import [KleitonBarone/returns-and-refunds](https://github.com/KleitonBarone/returns-and-refunds)
as a **new Vercel project** and select the finished commit on `main`.
The repository's [vercel.json](../vercel.json) supplies:

- Framework preset: Vite.
- Root directory: repository root, leave the subdirectory field empty.
- Install command: `pnpm install --frozen-lockfile`.
- Build command: `pnpm build:demo`.
- Output directory: `dist/demo`.
- Node.js: 24.x, as required by the package engines.

No database, Blob integration, function, daemon, secret, or environment variable
is required. The output contains only static HTML, CSS, and JavaScript. The full
backend stays in the repository and is not deployed by this configuration.
The application uses one page; switching personas or selecting returns does not
create server routes that need a rewrite.

After deploying, open the generated URL in a fresh browser session. Complete a
return, reload, recover `DEMO-UNKNOWN`, and reset. Remove deployment protection
for the public portfolio URL if it is enabled for your project. Vercel documents
[Vite hosting](https://vercel.com/docs/frameworks/frontend/vite) and
[project configuration](https://vercel.com/docs/project-configuration).

## Verify the deployment bundle locally

```sh
pnpm check
pnpm test
pnpm browser:install
pnpm test:demo
pnpm build
```

`test:demo` builds the production demo, starts an owned static server on an
assigned loopback port, and runs Chromium. It checks the complete workflow with
the network unavailable after loading, rejects API/external requests, and covers
reload, isolated visitors, reset, expiry, narrow recovery, and broken storage.
Playwright closes its browsers; global teardown closes the static server.
No application services or databases start. Screenshots and a JSON report replace
the fixed `.local/browser-demo-results` directory. Video and traces are off;
CI retains these diagnostics only on failure, for seven days.

To inspect the same output manually, run `pnpm build:demo`, then
`pnpm preview:demo`. Ctrl+C stops that server. Dependencies, Chromium, and the
two standard build directories are reusable; browser tests do not change the
full application's retained development volumes.

## Outcome

Ship a static portfolio build from this repository. Visitors use the existing
customer and operator UI, with fictional data and payment outcomes stored only in
their browser. Vercel serves files; no database, Blob, server function, visitor account,
or background worker is required by the deployed demo.

The full PostgreSQL application remains the default local build. Browser state
demonstrates the workflow, not server authorization, transaction isolation, worker
leases, independent payment settlement, or crash recovery guarantees.

## Delivery plan

1. Add a typed browser adapter behind the shared API helper. Reuse the existing
   request and response contracts. Cover unit reservations, decisions, simulated
   confirmation, lost responses, original-operation recovery, expiry, and merchant
   views. Persist a bounded, versioned snapshot under one owned localStorage key.
   Handle malformed data and unavailable storage without losing the current session.
2. Add a browser-demo disclosure, payment-outcome control, recovery starting case,
   and confirmed reset. Reset only this demo's data and query state. Keep the same
   forms, confirmations, history, focus behavior, and narrow layouts as the full app.
3. Add separate development/build/preview commands, a static-only browser test
   runner, CI coverage, and root-level Vercel configuration. Verify the production
   output through the complete UI with no API requests, persistence across reload,
   visitor isolation, reset, expiry, recovery, and storage failure.
4. Review the finished diff, commit the cohesive delivery as
   `Add a browser-only portfolio demo`, push to main following the current repository
   workflow, and verify the exact commit's CI. No PR or public deployment is planned
   for this delivery. Hand over the Vercel import settings after all gates pass.

## Testing and cleanup

Use the pinned Node/pnpm and existing Chromium installation. Browser-demo tests
must serve the built static output on an assigned loopback port, create isolated
browser contexts, and own server/browser shutdown on success, failure, and cancel.
They must not start Docker, the API, the worker, or either database. Keep only one
bounded screenshot/report directory. Reuse installed dependencies and Chromium;
preserve existing development data and unrelated resources.

Run focused unit tests, type/lint checks, the ordinary application build, and the
static browser journeys locally. CI also runs the established full-application
integration, lifecycle, and browser suites on the final pushed commit.

## Completion gates

The built static journeys, storage/unit checks, desktop and 390-pixel visual
inspection, ordinary application build, links, and Vercel configuration must pass
before handoff. Require green CI on the selected pushed commit before deployment;
it also runs the full application's integration, lifecycle, and browser suites.
Deployment remains a manual action for Kleiton.
