# Browser verification

Local checks on October 21, 2026 used Windows Node 24.20.0, pnpm 11.23.0,
Playwright 1.64.1, and its Chromium revision 1248, Chrome 156.0.8078.4.
Docker 29.8.0 and Compose 5.5.1 ran through WSL Ubuntu at the verified local
socket. Every automated run owned fresh app/provider databases and loopback
ports. The API, worker, simulator, and production web build were real services.

Two fresh successful runs were `f9b8c84c-e3f3-4e6a-a66a-fe6b847d77d1`
and `2734ad2f-d16f-41d7-8e4b-f1de78dda1f6`, each prefixed
`codex-returns-test-`. Both journeys passed in each run, taking 19.7 and 20.1
seconds for the browser checks, excluding setup and teardown.

The keyboard journey requested one $35 tee, held the real order row lock to
inspect disabled in-flight controls, cancelled and confirmed approval, recorded
receipt and passing inspection, and confirmed the finance amount. The provider
stored success and dropped its response while events stayed delayed. The UI
showed unknown, then actual API, worker, and simulator restarts preserved the
operation. Finance checked the original key and recovered success. Three signed
copies of a late processing event returned 200 without changing success.
The provider contained one $35 ledger entry and the app contained one financial
success audit. Finance's separate status-check audit retained its reason.
Maya saw the confirmed refund, history, and two remaining tee units.

The second journey covered an expired order, disabled request controls, narrow
back navigation, empty search results, filter reset, an actual API outage,
successful retry after API restart, and the separate merchant's empty queue.
Both journeys used native keyboard navigation for forms, actions, confirmation,
and persona selection. Layout assertions reject horizontal overflow at 390 pixels.

The second environment paused for manual review before its automated tests.
The T3 preview opened it but snapshots failed twice with
`Preview automation snapshot timed out after 15000ms.` A separate Chrome task tab
provided the manual fallback. Inspection checked the eligible form on desktop,
the expired form at 390 by 844, disabled controls, heading focus, Shift+Tab to
the back button, and Enter returning focus to the queue. The viewport override
was reset and the task tab closed before resuming the automated journeys.

The successful run's actual provider diagnostics and operation identifiers are
in [browser-financial.json](browser-financial.json). Screenshots are in
[screenshots](screenshots/), including `eligible-manual-desktop.jpg`,
`expired-manual-narrow.jpg`, `refund-unknown-desktop.png`,
`refund-recovered-narrow.png`, and `service-unavailable-narrow.png`.
They contain synthetic data. They are author-performed local evidence and do
not represent a real payment provider or customer outcome.

Failure and interruption verification uses separate disposable runs. A deliberate
assertion failure must create fresh screenshots, assertion/console reports, and
accessible page state within the retention cap. A second run reaches browser
readiness before its verified supervisor is killed. Abandoned-run cleanup must
terminate the owned browser and all services, remove disposable data and profiles,
and release their ports. The two retained development volumes remain separate.

The initial Windows failure fixture was
`codex-returns-test-6904ddd9-ea57-4f52-b23c-4164a50dc8cc`; its seven retained
files totalled 62,037 bytes, including the retention summary. Supervisor-death
recovery passed on `codex-returns-test-41945be0-1682-4331-8964-bea59d6449de`.
Both environments finished verified cleanup. The existing four unit checks,
59 PostgreSQL/HTTP integration checks, production build, and complete service
lifecycle suite also passed. No disposable run directories remain. The matching
Chromium cache is intentionally reused, about 441 MiB; unrelated browser caches
and Docker resources were preserved.

The [first CI run](https://github.com/KleitonBarone/returns-and-refunds/actions/runs/39653347959)
on `fa2f1cc` passed the earlier checks but Chromium aborted before either browser
journey. Its `SingletonSocket` path under the long checkout exceeded the Unix
socket path limit. A separate Linux checkout reproduced that exact failure with
Node 24.20.0, pnpm 11.23.0, Playwright 1.64.1, and Chromium revision 1248.

Unix browser storage now uses a private, short `/tmp/rr-<hash>` directory derived
from the run and workspace identities. Browser configuration and caches use
subdirectories there. Cleanup validates its canonical path and owner marker,
stops the owned browser, and removes the directory. Windows keeps its storage
under the recorded run. Diagnostic retention records the browser storage path
so failure verification can assert that it was removed.

Both journeys passed in two fresh Linux runs, in 14.0 and 14.1 seconds. The final
run was `codex-returns-test-a7fac500-b304-4b85-9cd3-abf66003fb37`.
Failure diagnostics and supervisor-death cleanup also passed, including an
explicit refusal to delete storage with a mismatched workspace marker. The final
failure fixture was `codex-returns-test-a90cc69a-1e3f-4191-878a-deb7db8f78bf`;
its seven diagnostic files totalled 82,077 bytes. Abandoned-run recovery passed on
`codex-returns-test-e73c7e63-4858-4f94-b14b-e6d9ef565f56`. Windows storage and
interruption checks also passed with the ownership marker. The isolated Linux
tools, dependencies, browser cache, source checkout, and test services were
removed after verification.
