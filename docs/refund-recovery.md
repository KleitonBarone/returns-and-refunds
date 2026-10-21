# Recovering an uncertain refund

Finance opens the existing return, records a recovery reason, and chooses
**Check payment status**. This looks up the original payment key. It does not
create another operation or submit a refund. A matching successful receipt closes
the return and consumes its selected units in the same transaction as the receipt,
status, job acknowledgement, and audit.

If lookup is unavailable or returns a conflicting identity, the outcome remains
unknown. Its units and amount stay reserved. If the service confirms that the key
does not exist, finance can review and confirm **Retry original refund**. That
requeues the existing job with the same operation, amount, currency, payment
reference, key, and fingerprint. Concurrent retry clicks queue it once. A terminal
rejection cannot be retried or replaced in this demo.

The API checks the finance role and merchant from the server session for both
actions. It records the actor, reason, correlation ID, and before/after states.
Lookup happens outside SQL transactions; the operation is locked and rechecked
before applying its result. A signed event can complete the refund while a lookup
or worker request is in flight. Later responses cannot undo confirmed success.
Return details use a repeatable-read snapshot so status, receipt, and history
describe one committed state.

## Signed events

Only `POST /api/provider-events` accepts service callbacks without a browser
Origin. Its private Fastify parser retains the exact request bytes. All other
mutations retain the browser Origin and session checks.

The receiver validates the HMAC-SHA256 signature over `timestamp.rawBytes`, using
constant-time comparison. Delivery timestamps must be within 300 seconds of the
system clock. The event's occurrence time uses the fixed business clock and can
be much older. Delayed deliveries receive a fresh signature when sent.

The event must match the local provider, merchant, stable key, payment reference,
amount, currency, and any previously recorded provider receipt ID. An unmatched
event cannot create an operation. Every terminal event is confirmed through the
provider's original-key lookup before opening the database transaction. This also
resolves contradictory terminal events without trusting arrival order. If lookup
is unavailable, the endpoint returns 503 without acknowledging the event, so the
simulator retains it for retry.

The receiver locks the order, return, and operation, then inserts the unique
provider/event receipt and applies its business effects in the same transaction.
The receipt stores the payload, its hash, and whether it was applied, ignored, or
reconciled. A repeated event has no additional financial or audit effect. Reusing
its ID with different bytes conflicts. A failed audit rolls back the event receipt
as well, allowing a later delivery to try again.

Processing events cannot downgrade a terminal result. Success never regresses.
A contradictory success event for a rejected refund is reconciled against the
provider's rejected receipt. A contradictory failure event for a successful refund
is reconciled against its successful receipt. Confirmation also fences unfinished
worker attempts, so a delayed timeout cannot overwrite the event's result.

These guarantees use the simulator's persistent key and lookup contract. A real
provider adapter would need its own retention, lookup, signature, and settlement
rules.

## Evidence

Integration tests exercise authorization, missing-key retry, unavailable and
mismatched lookup, raw-byte signatures and delivery timestamps, mismatched events,
concurrent duplicates and status checks, worker/event races, contradictory events,
and audit rollback. A real HTTP receiver also accepts the simulator's signed
duplicate deliveries. Each financial assertion compares the independent simulator
ledger.

Environment verification creates a lost-response refund, restarts the actual API,
worker, and simulator without clearing their databases, and recovers the original
operation by lookup. It then delivers delayed processing and contradictory
duplicate terminal events, checking one financial entry and one success audit.
The separate worker-crash scenario still verifies lease reclamation after provider
success. Both scenarios run in two fresh disposable environments with verified
teardown.

Fastify documents [encapsulated raw-body parsers](https://fastify.dev/docs/latest/Reference/ContentTypeParser/).
The simulator's [HTTP and event contract](payment-simulator.md) defines the signed
envelope and durable delivery behavior used here.
