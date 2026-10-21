# Local portfolio handoff

The customer, support, warehouse, finance, simulator, recovery, browser journeys,
and repeatable scenarios are implemented. Delivery PRs 1 through 8 are merged.
The final documentation/recording delivery is tracked in [PLAN.md](PLAN.md).
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

## Reproduce the recording

```sh
pnpm browser:install
pnpm demo:record
```

The recording follows the existing partial-return keyboard journey on fresh
paired databases. It creates one $35 refund with a dropped response, restarts
the actual API/worker/simulator, recovers the original operation, and checks one
independent ledger entry and one success audit after three signed event copies.
English captions are added only by the recording test. Intentional reading
intervals produce roughly 90 seconds; business assertions still wait on real
state. There is no spoken narration. The application code has no caption banner.

Recording is explicitly enabled only by `demo:record`. Ordinary tests keep video
and traces off. The latest WebM, caption transcript, financial record, and report
replace `.local/walkthrough-last`, capped at 100 files and 32 MiB. Browser profiles,
services, containers, network, and disposable databases are removed afterward.
For an MP4 release asset, convert the retained `video.webm` with an existing FFmpeg:

```sh
ffmpeg -i video.webm -c:v libx264 -crf 23 -preset medium -pix_fmt yuv420p -movflags +faststart -an returns-and-refunds.mp4
```

FFmpeg is optional for app setup and WebM recording. The published
[walkthrough release](https://github.com/KleitonBarone/returns-and-refunds/releases/tag/portfolio-walkthrough-2026-10-21)
keeps large media outside Git. The [walkthrough notes](docs/walkthrough.md) link its
actual financial evidence and transcript.

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

After the final PR merges, the final
remote SHA must be checked in that separate clone and its final checks rerun.
The release's `final-verification.json` records that post-merge result; this file
does not claim a future merge or its checks in advance.

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
replace two fixed JSON files. Recording replaces its own bounded directory.

The pinned PostgreSQL image, installed package dependencies, matching Chromium
cache, and two original development volumes are intentionally retained for reuse.
The volumes contain earlier fictional return progress; tests and recording never
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
and the web build are under 1 MiB each. The temporary clean clone, its separate
browser cache, and local recording/conversion files are tracked until final
remote verification and removed afterward. The published release retains the MP4.
