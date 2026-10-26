# Develop and inspect locally

Start with the [README](../README.md) for prerequisites and the verification
commands. Use the repository's environment runners so services, credentials,
databases, and cleanup belong to one recorded run.

This guide covers the full PostgreSQL application. The separate
[browser demo guide](browser-demo.md) covers static development, testing, and
Vercel deployment without application services or databases.

## Choose an environment

| Command | Data and shutdown |
| --- | --- |
| `pnpm dev` | Preserves progress in two checkout-specific development volumes. Ctrl+C or `pnpm dev:down` stops services and keeps both volumes. |
| `pnpm demo:run` | Seeds the [demo scenarios](repeatable-demo.md) on assigned ports. Ctrl+C removes its disposable databases and services. |
| `pnpm test:e2e --inspect` | Pauses a fresh browser fixture at a printed URL. Enter runs the journeys and cleans up; Ctrl+C ends inspection early. |

Every runner starts separate application and simulator PostgreSQL instances,
applies migrations and seed, checks service identities, and waits for the worker
heartbeat. A critical service exiting unexpectedly fails the run and triggers
cleanup. Supported service restarts and demo resets update the supervised process
identities.

`.env.example` lists optional development ports and the fixed business clock.
`pnpm env:doctor` checks prerequisites. `pnpm env:doctor --dev` also checks configured
nonzero development ports; zero requests an assigned port. Disposable runs choose
their own ports and credentials.

Install Chromium with `pnpm browser:install` before browser checks. On Linux,
`pnpm browser:install --with-deps` also installs its system libraries. The browser
cache belongs to this checkout under `.local/browsers`.

## Change schemas and retain existing data

Generate application migrations with `pnpm db:generate`. For simulator schema
changes, use:

```sh
pnpm exec drizzle-kit generate --config apps/simulator/drizzle.config.ts
```

Keep the SQL migrations and Drizzle metadata together. Startup migrates both
databases and inserts missing fixtures without clearing existing return or payment
history. Check retained-state behavior as well as fresh fixtures when changing
schemas or financial contracts. Recovery checks must preserve the provider ledger;
resetting it would hide duplicate refunds.

Checkout identity preserves Linux path case and ignores case on Windows. An
uppercase Linux path used before the case-preserving identity fix gets new
development volumes. Stop that old environment with its original runner and
explicitly back up or migrate its volumes if their data is needed. New runners
do not adopt or remove them automatically.

## Capture screenshots

Run `pnpm test:e2e`. Screenshots, `financial-evidence.json`, and `report.json`
replace `.local/e2e-last-success`. Find images beneath its journey directories.
The suite uses actual services and databases, including service outages and
restart recovery. Video and traces are disabled.

The [capture record](evidence/screenshot-capture.json) maps the nine published
images to their original capture filenames. Refresh the [walkthrough](walkthrough.md)
only after all journeys pass. Select readable screenshots, copy the matching
financial evidence, and record the actual source, run, hashes, dimensions, and
teardown. Keep the published image set under 2 MiB and replace its previous set.
Never mix identifiers across runs or relabel historical evidence as a current run.

## Recover and clean up

Normal shutdown removes owned processes, containers, networks, temporary browser
profiles, and run directories. Tests and demos also remove their disposable
volumes. Development shutdown retains its two volumes. Demo shutdown waits for
an active reset to settle before taking the cleanup snapshot.

For an abandoned run, preview its recorded resources before applying cleanup:

```sh
pnpm env:clean <printed-run-id>
pnpm env:clean <printed-run-id> --apply
```

`pnpm env:clean --all --apply` handles recorded inactive runs for this checkout.
It refuses active or mismatched ownership. Inspect refusals instead of deleting
similarly named resources. Avoid global Docker pruning, unrelated process kills,
and WSL shutdown.

Manifests live in ignored `.local/runs` and use atomic replacement. Child logs
are capped at 5 MiB; the latest failure log is capped at 1 MiB. Browser diagnostics
replace one directory per outcome, each capped at 100 files and 32 MiB. Scenario
summaries replace `.local/demo-last-run.json` and `.local/demo-last-verification.json`.
CI retains failure artifacts for seven days.

Dependencies, the pinned PostgreSQL image, Chromium, and development data remain
available for reuse. After all runs stop, generated `dist/` and diagnostics outside
`.local/runs` can be removed. Removing this checkout's `.local/browsers` is optional;
the next browser check requires `pnpm browser:install` again. Keep retained volumes
and shared package or Docker caches unless deliberately discarding their data.

## Verify an independent checkout

Install from the frozen lockfile in a separate clone and run the README checks
sequentially. No sibling checkout, `.env`, existing database, or payment account
is required. `pnpm demo:run --once` seeds, checks, and tears down the scenarios
without leaving an interactive environment. Use the printed run IDs to confirm
cleanup, and account separately for any retained development volumes and caches
created by that checkout.
