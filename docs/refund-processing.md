# Refund processing

Finance can refund a return after a passing inspection. The confirmation shows
the exact merchandise amount in the order's currency. The API derives the actor,
merchant, payment reference, unit values, and capacity from persisted records.
The browser cannot choose them.

## Before contacting the payment service

The API locks the order, then the return. It verifies that every selected unit
is still reserved and unconsumed, the confirmed amount matches their stored sum,
and all refund reservations fit within the captured amount. It commits one
operation, one outbox job, and the finance audit entry together. An audit failure
rolls everything back. No provider request occurs inside this transaction.

Each return has one operation. Repeated finance submissions return that operation,
including after success, rejection, or an uncertain outcome. Its amount, currency,
merchant, payment reference, idempotency key, and fingerprint stay unchanged.
Succeeded, pending, processing, unknown, and failed operations all count against
capacity. Failed operations conservatively hold their units and amount because
this demo has no replacement-operation or manual-resolution workflow.

## Worker ownership and completion

The supervised worker records a run-specific heartbeat before the environment is
ready. It claims a due job with a ten-second lease and a unique ownership token,
records an attempt, and commits before making HTTP requests. It uses the same
order, return, operation, and job lock order when claiming and completing work.

A dead worker leaves its job durable. After lease expiry, a replacement marks the
old attempt abandoned and submits the original key and payload. The independent
simulator replays its persisted receipt rather than writing another financial
refund. A late completion carrying an earlier token cannot change the operation.

Completion commits the provider receipt, operation status, job acknowledgement,
attempt result, and audit together. Confirmed success also closes the return,
releases its active claims, and permanently consumes the selected units in that
transaction. A failed audit leaves those changes unapplied; reclaiming the job
obtains the same provider receipt. SQL transactions never span provider HTTP.

## Outcomes

| State | Meaning and next behavior |
| --- | --- |
| Pending | The job is queued, or a confirmed pre-write rejection will retry. |
| Processing | A worker has claimed the operation and is contacting the service. |
| Succeeded | A matching provider receipt confirms the refund; the return is closed. |
| Failed | The provider rejected it permanently; a new operation is not allowed. |
| Unknown | A response was lost, timed out, invalid, or mismatched; reservations remain held. |

Only the simulator's explicit HTTP 503 `retryable: true` response establishes that
an attempt failed before a financial write. Its retry uses persisted exponential
backoff from one second to thirty seconds. Other transport or validation failures
become unknown. The HTTP timeout defaults to 750 milliseconds; the lease is longer
than the maximum configurable five-second timeout.

The finance and customer views show the same refund status and confirmed receipt.
Queued and processing operations refresh automatically. Unknown status checks and
signed event consumption are the next delivery; an unknown operation currently
stays held. Provider events remain queued until that consumer exists.

## Verification

`pnpm test:integration` covers authorization, inspection and amount guards,
concurrent same-return submission, order-wide capacity, retry timing, successful
closure, rejected and lost-response outcomes, mismatched receipts, expired claims,
stale completion fencing, and transactional rollback. Tests compare the simulator's
independent ledger and verify an order lock remains available during HTTP.

`pnpm test:environment` uses actual API, worker, and simulator processes. In each
of two disposable environments it waits for a provider ledger write while its
response is delayed, kills the verified run-owned worker, and confirms the app
has not acknowledged it. It advances only that fixture's lease, starts a fresh
worker, and verifies the original operation succeeds with one ledger entry and
one success audit. This also verifies worker readiness and teardown after failed
startup and abrupt supervisor termination. Test data and processes are removed;
normal development shutdown retains both project demo volumes.

These checks demonstrate this local simulator contract. They make no claim about
a real payment provider, card settlement, or production authentication.
