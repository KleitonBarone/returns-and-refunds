# Recovering a refund after the response disappears

A customer returns one $35 tee from an order containing three tees and a cap.
Support approves it, the warehouse receives and accepts it, and finance confirms
the amount. The payment simulator commits success to its own ledger and drops
the HTTP response. From the app's perspective, the outcome is uncertain.

The project makes that uncertainty visible. It keeps the original operation,
units, and amount reserved. Finance can check its original key after the API,
worker, and simulator restart. A matching receipt closes the return without
submitting another refund.

![Unknown outcome before recovery](evidence/screenshots/04-refund-unknown.png)

## The implementation decision

Putting a provider request inside a database transaction would keep locks open
through network failures and still could not roll back the provider's write.
Instead, finance commits an immutable operation and outbox job with its audit.
The worker owns a leased attempt, performs HTTP after committing, and rechecks
its token before applying the result. The same payment key identifies every
attempt and lookup for that operation.

The app does not infer failure from a timeout. An unknown operation retains its
reservation. A provider lookup can establish success, rejection, a missing key,
or continued uncertainty. Only a confirmed missing key enables a reviewed retry
of the original operation. The database and service locks keep concurrent clicks,
workers, and callbacks on that same financial identity.

Events arrive independently of worker responses. The receiver verifies raw-byte
signatures, matches the full financial identity, and checks terminal observations
against provider lookup. A unique receipt and its business/audit effects share a
transaction. Replaying a signed event cannot duplicate a refund or its success
audit, and a late processing observation cannot undo success.

## What was observed

The [screenshot financial record](evidence/screenshot-financial.json) contains an
actual $35 partial refund, its app operation and provider identifiers, and three
late signed processing-event copies. The app recovered the same operation after
real service restarts. The simulator held one USD ledger entry of 3500 minor units,
or $35, and the app held one successful business audit. Two tees remained
available. The [screenshot walkthrough](walkthrough.md) follows that same return and
links its capture provenance. These records describe their original source
revisions; run the browser suite to verify the current checkout.

The [repeatable verification](evidence/repeatable-financial.json) runs a broader
set twice. Each cycle has three successful provider entries totaling 10500.
Before recovery the app confirms 7000 and holds 3500 as unknown. Restart recovery
leaves the ledger exactly unchanged and brings the confirmed app amount to 10500.
A separate crash check kills the worker after the provider commits, reclaims its
lease, and still obtains one refund. Recovery checks preserve data; reset is
tested separately so deleting the ledger cannot hide duplication.

The reset verifier also refuses missing or mismatched markers without changing
any row. A failure between application and provider reset commits stays visible
and stopped. An active reset finishes before shutdown takes its cleanup snapshot.
These details matter for a runnable portfolio: verification should not erase
financial evidence or accumulate abandoned environments.

## Limits

All customers, orders, and payments are fictional. The simulator implements a
persistent key/receipt/ledger contract, not a real provider's settlement system.
This evidence does not establish production scale, customer impact, provider
certification, or compatibility with Stripe. Local persona sessions demonstrate
role and tenant checks without production identity management. Terminally rejected
refunds retain their reservation because manual resolution is outside this demo.

A real integration would need provider-specific key retention, authenticated
lookup and webhook rules, reconciliation and manual resolution, production
identity, secrets, deployment, and operational monitoring. Those are explicit
future scope. The current result is a local workflow whose financial state and
recovery behavior can be reproduced and inspected.
