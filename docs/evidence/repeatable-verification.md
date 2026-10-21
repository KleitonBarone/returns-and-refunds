# Repeatable scenario verification

Author-performed local verification on October 21, 2026 used Windows Node
24.20.0 and pnpm 11.23.0, with Docker 29.8.0 and Compose 5.5.1 in WSL Ubuntu.
Both databases use the pinned PostgreSQL 18.1 Alpine image. The source implementation
is commit `28f128f8655017eef6982cb48b846c6d3e125d73`.

The [scenario guide](../repeatable-demo.md) documents the commands, reset scope,
controlled scheduling, and simulator limits. The verification summaries record
actual operation, return, provider, and event IDs without session or control tokens.
[repeatable-financial.json](repeatable-financial.json) records the committed-source
run `codex-returns-test-5c7d8cb2-8b7f-44a7-927e-4bf0b417aa19`. Both cycles, reset
refusals, and injected partial failure passed. Verified teardown completed at
`2026-10-21T19:08:32.932Z` with no disposable resources retained.

## Financial results

Each reset creates a fresh set of operation IDs and the same results:

| Assertion | Result before recovery | Result after restart recovery |
| --- | --- | --- |
| Provider ledger | Three entries, 10500 USD minor units | Exactly the same ledger rows |
| App-confirmed amount | 7000 | 10500 |
| Unknown refund | 3500 reserved, original operation retained | Same operation and provider ID, succeeded |
| Unknown submission attempts | One | One |
| Late processing replay | Held behind a fixture schedule barrier | Three signed copies return 200, one ignored event receipt |
| Business success audits for recovered refund | Zero | One |

The normal partial refund consumes one unit permanently. The unknown operation
reserves its unit without consuming it. Failed inspection closes the return and
releases both units. The expired order rejects a request with HTTP 422; trying
to return both units after one was refunded returns 409. The other merchant's
request is readable by its own support persona and returns 404 to Northline's.
The retryable submission records a pre-write rejection and then succeeds using
the same operation, with one financial ledger entry.

## Reset refusal and incomplete commits

The verifier stops the worker and snapshots a digest of every application and
provider row. It separately removes the application demo-only marker, changes the
application disposable flag, changes the provider pairing identity, and removes
the provider demo-only marker. Every reset fails before modifying any rows.
A crossed provider/application connection address is also refused.

A final fixture fails after the application reset commits and before the provider
commit. The provider transaction rolls back, preserving its three ledger rows.
The reset journal says failed and records only the application commit. API and
simulator ports are closed. The supervisor then removes that disposable pair.
The databases retain separate commit boundaries; an incomplete reset is reported
and the disposable environment is discarded.

The interactive command was also exercised from a separate terminal on run
`codex-returns-test-f87d1142-1770-4ebf-8bbb-5829288ede40` before the implementation
commit. The command rebuilt the same 10500 provider total with new operation IDs,
then the run's stop request completed normal disposable cleanup. Its original
development volumes were not reset. The checked-in JSON contains the final
committed-source verification rather than that earlier working-tree run.

## Startup and ownership fixes

A fresh database run exposed an initialization race. The original health check
observed PostgreSQL's temporary Unix initialization socket before TCP connections
were ready. Both database probes now use `pg_isready -h 127.0.0.1`.

Repeated service restarts also exposed Windows PID reuse in the accumulated child
history. Service helpers now select the latest recorded identity for a PID and
clear the current service PID after verified shutdown. Birth and command-hash
checks still refuse a different live process. Completed failed runs were cleaned
before another environment started.

Four unit checks, 59 PostgreSQL/HTTP integration checks, type/lint/format checks,
and the production web build passed. The full service lifecycle suite passed two
fresh runs, actual worker crash after the provider write, service restarts,
persisted migration/seed reruns, failed startup, supervisor death, and preservation
of unrelated resources. Both keyboard browser journeys passed in 19.4 seconds,
excluding setup and teardown. Browser failure/interruption verification retained
seven bounded diagnostic files totaling 62187 bytes and verified complete cleanup,
including refusal of a mismatched temporary-storage marker.

Commit `0860c7005307e229c9594ba92afbb6604b7fa6b3` serializes demo shutdown with an
active reset. A separate-terminal reset on
`codex-returns-test-9e4281e0-54d7-4823-94d5-66f43d1cc409` was still in its
`resetting` phase, without a command result, when the stop request arrived.
The reset completed with exit code zero. The supervisor then exited zero after
verified teardown at `2026-10-21T19:15:28.472Z`. The
[shutdown record](demo-shutdown.json) contains the observed phase and cleanup
result. No run directory, owned container, or owned network remained. Only the
two original development volumes remained. No new image or browser cache was
downloaded for this delivery; the existing matching browser cache is reused.
