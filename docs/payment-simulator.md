# Local payment simulator

The simulator is a separate loopback HTTP service with its own PostgreSQL cluster,
credentials, migrations, captured payments, idempotency records, ledger, and event
deliveries. The returns API and worker receive its HTTP credential, but no
simulator SQL or control credential. This is configuration isolation within a local
demo, not an operating-system security boundary between processes run by one user.

`pnpm dev` starts it on `127.0.0.1:4322` and its database on `127.0.0.1:55433`.
Both use the same run identity as the application. `pnpm dev:down` removes their
processes, containers, and network while preserving both development volumes.
Integration and lifecycle runs use unique identities, ports, credentials, and
disposable volumes.

## Local controls

With `pnpm dev` running:

```sh
pnpm simulator:inspect
pnpm simulator:control payment-order-1042 drop_response
pnpm simulator:control payment-order-1042 success
```

The inspect command prints the synthetic ledger, refund receipts, and delivery
status. A configured mode applies to new refunds on that captured payment until
changed; the `retry_once` counter is consumed once. Replaying
an existing key always returns its stored outcome, regardless of the current mode.
The optional last argument selects the merchant; it defaults to `northline`.
Neither command prints credentials. They refuse an inactive or mismatched local run.

| Mode | First new submission |
| --- | --- |
| `success` | Commits a successful receipt, one ledger entry, and events. |
| `reject` | Persists a terminal failed receipt and events, with no ledger entry. |
| `retry_once` | Returns 503 before any refund or ledger write. A persisted counter allows the same key to succeed on retry. |
| `drop_response` | Commits success, then destroys the HTTP response connection. Lookup or replay finds the same receipt. |
| `delay_response` | Commits success, then delays the response. The CLI uses one second; HTTP controls allow up to five. |

Development credentials are predictable local demo values derived from the checkout
identity. Test runs generate fresh values. They are not suitable for a hosted service.
The active supervisor stores the control URL/token in ignored run storage and removes
that file at shutdown. Keep this service on loopback.

## HTTP contract

`GET /health` is public and returns the service/run/database identity. All other
routes require a bearer credential. `/v1` uses the application HTTP credential;
`/control` requires a separate supervisor/control credential. Authorization uses
the matched route pattern, including when an incoming path is encoded.

`POST /v1/merchants/:merchantId/refunds` accepts:

```json
{
  "paymentRef": "payment-order-1042",
  "idempotencyKey": "one-stable-key-for-this-refund",
  "amountMinor": 3500,
  "currency": "USD"
}
```

New accepted operations return 201. Replays return 200 with the same receipt ID,
merchant, payment, key, amount, currency, status, and optional failure code. A key
is scoped to its merchant and retained until an explicit paired demo reset. A
changed payload under an existing key returns 409. Missing captures return 404,
currency mismatches 422, and malformed bodies 400. Amounts must be positive integer
minor units within PostgreSQL's integer range.

The transaction locks the captured payment before checking capacity. Succeeded
and processing receipts reserve capacity, so concurrent keys cannot exceed the
capture. A unique merchant/key constraint also protects conflicting submissions
against different captured payments. Receipt, successful ledger entry, and event
scheduling commit together. Failed receipts do not consume capture capacity.

`GET /v1/merchants/:merchantId/refunds/:key` returns the persisted receipt, or 404
when that merchant has no such key. A lost or timed-out POST response is uncertain;
it is not evidence of a failed financial write. A 503 from the simulator's explicit
pre-write failure mode permits resubmission with the original key and payload.
Replays after dropped/delayed responses return normally. No new key is needed.

The dropped-response control commits before using Fastify's documented
[`reply.hijack()`](https://fastify.dev/docs/v5.12.x/Reference/Reply/#hijack) and
destroying the underlying connection. Contract tests use real HTTP sockets.

## Events and delivery

Every accepted operation schedules a processing event and its terminal event.
The configured event delay applies to both, so a lost-response scenario can stay
unknown until finance checks it. Processing and terminal delivery order is not
guaranteed; the consumer applies status guards.
The event envelope contains `id`, `provider: local-simulator`, `occurredAt`, and
the refund receipt. `occurredAt` follows the controlled business clock. Each send
uses the current wall clock in `x-simulator-timestamp`, as integer epoch seconds.
`x-simulator-signature` is the lowercase hex HMAC-SHA256 of
`timestamp + "." + rawBody`, using the shared local signing key. Signatures cover
the exact UTF-8 bytes sent, and are renewed on retries. The consumer enforces
a five-minute delivery timestamp tolerance.

Deliveries persist before HTTP. Senders claim due rows with
[`FOR UPDATE SKIP LOCKED`](https://www.postgresql.org/docs/18/sql-select.html#SQL-FOR-UPDATE-SHARE),
then release the transaction before sending. A two-second lease and unique token
fence completion. The HTTP timeout is 750 ms. Failed sends retain their payload,
increment attempts, and retry with exponential backoff capped at 30 seconds.
An expired sender cannot overwrite a successor's acknowledgement. A 2xx response
marks delivery complete; all other responses remain retryable.

The development process sends automatically. Integration runs pause automatic
sending so tests can drive delivery with explicit barriers or an injected due-time
clock. Delayed events retain their original occurrence time and event ID. Duplicate
copies have separate delivery IDs and the same event ID and body.

Authenticated control endpoints are:

| Route | Purpose |
| --- | --- |
| `POST /control/captures` | Create a synthetic capture. Existing identities conflict rather than overwrite financial history. |
| `POST /control/payments` | Configure mode, response delay, terminal-event delay up to 60 seconds, and 1–3 copies. |
| `POST /control/events` | Schedule copies of an existing refund event with a chosen status, including intentionally contradictory diagnostic events. This does not change the financial ledger. |
| `POST /control/deliver` | Send up to ten due deliveries, optionally filtered by refund ID. |
| `GET /control/diagnostics` | Inspect up to 100 receipts, ledger rows, and delivery states. The response excludes credentials. |

## Persistence, reset, and verification

Startup only inserts missing captures. It never deletes keys, receipts, ledger
entries, or delivery progress. The four initial captures match the fictional
orders at 15,500 USD minor units each. Provider tables live only in the simulator
database. Application SQL credentials fail authentication against that cluster.

There is no standalone ledger reset command. The [disposable demo reset](repeatable-demo.md)
quiesces the API, worker, and simulator and verifies both database identities
before clearing the paired application/provider data. It cannot reset retained
development data. Test teardown removes only its own disposable pair.

`pnpm test:integration` covers replay, changed payloads, concurrency,
capture limits, ownership, integer/currency validation, terminal rejection,
pre-write retry, atomic rollback when event scheduling fails, dropped/delayed
responses, reopened server/database connections,
raw signed duplicates, delayed delivery, delivery backoff, stale-sender fencing,
and SQL/control credential isolation. `pnpm test:environment` checks fresh
environments, migration/seed preservation, an actual simulator process restart
with one retained ledger entry and two pending events, failed-startup cleanup,
abrupt interruption, abandoned-run recovery, and preservation of unrelated resources.

These checks describe this simulator contract. They do not certify behavior of
Stripe or another payment provider.
