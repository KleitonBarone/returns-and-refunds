# Local portfolio handoff

The customer, support, warehouse, finance, simulator, recovery, browser journeys,
and repeatable scenarios are implemented. All nine implementation deliveries are
merged. The current walkthrough uses [screenshots](docs/walkthrough.md); its
replacement delivery and original history are tracked in [PLAN.md](PLAN.md).
Public hosting and real payment integration remain separate scope.

## Start and inspect

The [README](README.md) is the shortest setup path. `pnpm demo:run` creates a
disposable, populated environment on assigned ports. `pnpm dev` preserves progress
in checkout-specific development volumes. Both supervise the app/provider
PostgreSQL instances, API, worker, simulator, and web process. Startup applies
migrations and seed, checks database/service identity, and waits for the worker's
heartbeat. The application uses integer minor units and the fixed fictional clock.

Use Sam's `DEMO-UNKNOWN` return for a quick recovery demonstration. To start with
an empty workflow, use the disposable browser runner's inspection pause:

```sh
pnpm browser:install
pnpm test:e2e --inspect
```

Open the printed URL. Press Enter in the runner to execute its real keyboard
journeys and clean up. Ctrl+C ends inspection early. Normal browser checks use
the same fresh full stack without the pause. On Linux, `browser:install --with-deps`
also installs Chromium system libraries; CI provisions them on its runner.
`test:e2e:environment` deliberately fails an assertion and terminates its owned
supervisor. Its successful exit means the diagnostics and recovery checks passed.

## Reproduce the screenshots

```sh
pnpm browser:install
pnpm test:e2e
```

The existing keyboard journey creates one $35 refund with a dropped response on
fresh paired databases. It restarts the actual API, worker, and simulator,
recovers the original operation, and verifies one ledger entry and one success
audit after three signed late-event copies. Screenshots capture asserted UI
states directly. Video and traces stay off; there are no caption overlays or
timed reading pauses.

Successful screenshots, `financial-evidence.json`, and `report.json` replace
`.local/e2e-last-success`. Find them beneath its journey subdirectories. The six
main capture filenames are `customer-desktop.png`, `support-approved-desktop.png`,
`warehouse-inspected-desktop.png`, `finance-unknown-desktop.png`,
`finance-recovered-desktop.png`, and `customer-recovered-desktop.png`. The second
journey adds narrow expiry and service-outage views; the first also saves narrow
customer history. The [capture record](docs/evidence/screenshot-capture.json)
maps these names to the nine published images and records hashes, dimensions,
source, and verified teardown.

To refresh the guide, select images only after both journeys pass. Copy their
matching financial evidence, inspect readability, and replace the curated set
under `docs/evidence/screenshots`. Keep it under 2 MiB. Do not mix identifiers from
different runs. The temporary browser profiles, services, containers, network,
and disposable databases are removed by the runner. Diagnostics replace one
bounded directory per outcome, capped at 100 files and 32 MiB.

## Verify a fresh checkout

Clone the public repository into a separate directory, install from the frozen
lockfile, then run the README checks sequentially. No sibling repository, `.env`,
existing database, provider account, or paid service is required. Browser binaries
belong to that checkout's `.local/browsers`; `browser:install` obtains the pinned
revision. `pnpm demo:run --once` exercises automatic migration, seed, scenarios,
and teardown without leaving an interactive environment running.

The [clean-checkout record](docs/evidence/clean-checkout.json) reports a public
clone of `8d727a6`, frozen install, preflight, all checks, browser download, demo,
and development startup/shutdown. All 15 commands exited zero. Both browser
journeys passed in 21.5 seconds. The rehearsal used its own workspace identity,
ports, databases, and browser cache. A temporary `.env` set all five port values
to zero to obtain assigned development ports; it was removed afterward.
Development shutdown preserved the newly created volumes, then explicit
ownership-checked rehearsal cleanup removed just those two volumes. Original
development data survived. No rehearsal service, network, or volume remains.

The original final PR merged as `d7a6ac0`. Its exact remote SHA passed all 12 final
commands in the separate checkout, which was then removed. The release's
`final-verification.json` preserves that historical result. The current screenshot
delivery publishes `screenshot-verification.json` after its own merge and checks.
Both records state the source they actually verified.

## Recover and clean up

Ctrl+C stops an owned environment. `pnpm dev:down` requests normal development
shutdown and preserves both development volumes. Demo and test shutdown remove
their disposable volumes. A demo stop waits for an active reset before taking
the cleanup snapshot. Reset is a separate command and requires both paired
disposable-demo database markers. It cannot clear the retained development pair.

For an abandoned run, preview its exact resources and then apply cleanup:

```sh
pnpm env:clean <printed-run-id>
pnpm env:clean <printed-run-id> --apply
```

`pnpm env:clean --all --apply` handles recorded inactive runs for this checkout.
It refuses active or mismatched ownership. Never replace it with global Docker
pruning, killing unrelated processes, or shutting down WSL. A cleanup refusal is
evidence to inspect, not permission to remove a similarly named resource.

Run manifests live under ignored `.local/runs`. Each child log is capped at 5 MiB;
shutdown removes its run directory. The latest failure log is capped at 1 MiB.
Success/failure browser diagnostics each replace one directory, capped at 32 MiB
and 100 files. CI retains failure artifacts for seven days. Scenario summaries
replace two fixed JSON files. The published screenshot set replaces its previous
images rather than accumulating capture runs.

The pinned PostgreSQL image, installed package dependencies, matching Chromium
cache, and two original development volumes are intentionally retained for reuse.
The volumes contain earlier fictional return progress; screenshot runs and tests never
reset them. Temporary checkout dependencies, browser downloads, builds, and owned
data are removed when the rehearsal ends. The final evidence reports measured
retained disk usage. To discard an unused checkout's browser cache, first stop
its browser runs, then remove only that checkout's `.local/browsers`; reinstall
it with `browser:install` when needed. Shared package caches and Docker images
are not automatically pruned.

Measured retained resources are recorded in
[retained-resources.json](docs/evidence/retained-resources.json). The original
development pair uses about 64 and 63 MiB of logical file data. The PostgreSQL
image is about 383 MiB, the dedicated Chromium cache 441 MiB, and installed package
files 258 MiB. Package hard links and image layers can share physical storage;
these are not additive measurements of machine disk use. Browser diagnostics
and the web build are under 1 MiB each. These measurements describe the original
delivery. Its temporary clean clone, separate browser cache, and media files were
removed after verification. Current capture runs reuse the project's matching
browser cache and remove their disposable resources. Published screenshots live
in Git; the release keeps verification JSON rather than video assets.
