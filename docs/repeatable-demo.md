# Repeatable demo

Use Node 24.20.0, pnpm 11.23.0, and the Docker setup in the [README](../README.md).
These commands allocate their own application and payment-simulator databases on
assigned loopback ports. They do not reset or reuse the volumes from `pnpm dev`.

```sh
pnpm demo:run
```

Open the URL printed after setup. The runner seeds actual return histories and
prints its unique run ID. Choose Sam for finance and find `DEMO-UNKNOWN` to check
the original payment status. Choose Maya for customer history and remaining units.
`DEMO-NORMAL` has one permanently returned tee and one still available. Other
Store's request is visible only to Noah and Robin.

The business clock is fixed at `2026-10-01T12:00:00.000Z`. Seed construction uses
the real session, return, decision, and refund HTTP endpoints. It runs the same
outbox worker functions against the actual provider HTTP service with a controlled
scheduling clock. The pre-write retry advances to its recorded deadline instead
of waiting. The real worker process resumes after seeding. Provider event delivery
is manual in this disposable demo, so an unknown outcome remains inspectable.
No API, worker, or provider response is mocked.

| Case | Expected result |
| --- | --- |
| Normal partial refund | One tee, 3500 USD minor units, one successful ledger entry |
| Expired `NL-1031` | Request rejected with HTTP 422, no refund |
| Failed inspection | Closed without refund, both units available again |
| Retryable provider rejection before a write | One retryable attempt, then success with the same operation and one ledger entry |
| Lost response | App says unknown and retains 3500; the provider has one successful 3500 entry |
| Previously returned unit | Returning both tees from `DEMO-NORMAL` fails with HTTP 409; one remains available |
| Second merchant | Noah can request his return; Robin can read it; Ava receives HTTP 404 |

Before recovery, the three ledger entries total 10500, of which the app confirms
7000 and retains 3500 as unknown. The simulator models successful financial writes
with its own SQL ledger. It does not move real money or certify provider behavior.

## Reset this running demo

In a second terminal, use the exact run ID printed by `demo:run`:

```sh
pnpm demo:reset codex-returns-test-<printed-uuid>
```

The command accepts a run ID, never a connection string. It verifies the current
checkout, live supervisor identity, and disposable demo mode before sending a
serialized reset request. The supervisor checks both database names, their exact
owned loopback endpoints, matching environment identities, disposable flags, and
additional demo-only markers before changing data. It stops the API, worker, and
simulator, locks the explicit project tables, and checks the markers again before
truncating either database. The simulator ledger is part of this reset.

Reset starts the API and simulator for HTTP scenario seeding, then resumes the
worker and reports completion. Reload
the browser afterward to create a new demo session. Original development volumes
are ineligible even when their services are running.

The databases have separate commits. Reset records its phase in the run's
`demo-reset.json`. If either commit or seed fails, it reports an incomplete reset,
does not return the environment ready for use, and tears the disposable run down. Start a fresh
`demo:run`; do not use reset as financial recovery. A supervisor crash can leave
the run manifest and journal for inspection. Follow the scoped `env:clean`
recovery instructions in the README to remove that abandoned run.

## Verify and stop

```sh
pnpm demo:verify
pnpm demo:run --once
```

`demo:verify` performs two reset/seed/demo cycles and compares their financial
assertions, allowing new operation/event IDs. Each cycle separately restarts the
API, worker, and simulator before recovering the unknown operation. Its ledger
must remain exactly unchanged. Original events are held behind a fixture schedule
barrier; three newly signed copies of a late processing event must return HTTP
200, create one ignored receipt, and leave one successful business audit entry.

The verification also changes each database's markers in disposable fixtures and
compares a digest of every row before and after the refused reset. A crossed
database address is refused. A failure injected after the first commit must leave
the second database's ledger intact, a failed journal, and stopped services.

`demo:run --once` seeds and checks the scenarios, then tears down without opening
an interactive session. Both commands run the normal owned-resource cleanup.
Stop an interactive run with Ctrl+C. This removes its processes, containers,
network, databases, and run directory. It preserves the existing PostgreSQL image
and the original development data. It never performs global Docker pruning.
If a reset is in progress, shutdown lets that command settle before taking the
cleanup snapshot. It accepts no further reset commands while stopping.

The latest credential-free summaries replace `.local/demo-last-run.json` and
`.local/demo-last-verification.json`. Each stores only one bounded scenario run,
including IDs, amounts, ledger counts, event results, source SHA, and tool versions.
Checked-in financial evidence is linked from the delivery plan. Reset is separate
from normal development shutdown, automatic test teardown, and artifact cleanup.
