# Returns and refunds implementation plan

## Purpose and audience

Build a merchant console that handles one complete return: customer request,
policy decision, warehouse inspection, and refund. The product should explain
what happened to an order and what an operator should do next.

Recruiters should recognize commerce and financial operations immediately.
Engineers should be able to examine money calculations, concurrent updates,
state transitions, and recovery when a payment result is uncertain.

This is a local portfolio simulation. Orders, people, items, payments, and
businesses are fictional. No sales, customer interviews, paid integrations,
or movement of real money is required.

## Smallest complete product

Use one fictional clothing merchant and a second merchant for isolation checks.
The MVP supports a customer portal, an operator queue, and a warehouse inspection
view. Seed operators with support, warehouse, and finance permissions.

Each return selects specific order units and a reason. Fix the demonstration
policy at a 30-day window using UTC instants and an injectable clock. Return
eligibility must not depend on the operator's browser clock. Keep a snapshot of
the applied policy with the decision.

Use `requested`, `approved`, `received`, `inspection_passed`, `inspection_failed`,
and `closed` for the return workflow, plus an explicit rejection decision. Keep
refund state separate: `pending`, `processing`, `succeeded`, `failed`, or `unknown`.
A timeout is uncertain, not proof that the provider rejected the refund.

Use one currency per order and integer minor units for money. The first policy
refunds the stored net merchandise value for approved units. Exclude shipping,
tax calculation, currency conversion, and exchanges from the MVP. Reject excess
unit quantities and any refund total above the original captured amount.

## Starting architecture

- Use pnpm, strict TypeScript, React/Vite, Tailwind, and TanStack Query.
- Use a small Fastify API, PostgreSQL, and typed queries or Drizzle migrations.
- Validate boundary input with ArkType. Derive internal types instead of adding
  `any`, casts, or duplicated hand-maintained request shapes.
- Run refund processing in a worker from the same codebase. Persist refund intent
  and an outbox entry with the business transaction before contacting a provider.
- Define a small payment adapter for refund submission and status lookup. A local
  simulator is the default implementation and owns its own refund ledger.
- Use synthetic server sessions with a local persona picker. Enforce workspace,
  order ownership, and operator permissions in the API.

Start with merchants, users, memberships, customer accounts, orders, order lines,
return requests/items, inspections, refund operations, provider receipts, outbox
records, processed webhook receipts, and audit entries. Add them by milestone.
The simulator's independent ledger is needed to observe a provider-side success
even when the application never receives the response.

Reserve UI port 4320, API port 4321, simulator port 4322, and database port 55432.
These are planned defaults to verify when scaffolding. Keep databases, storage,
and local reset commands independent of the other projects.

## Local simulation and failure scenarios

Seed a normal partial return, a request outside the return window, a failed
inspection, a retryable refund failure, and an uncertain refund result. Include
multiple quantities, previously returned units, and a second merchant.

The payment simulator needs bounded controls for:

- Immediate success and terminal rejection.
- A retryable failure before recording a refund.
- Recording a successful refund and dropping or delaying the response.
- Duplicate and delayed signed status events.

Persist idempotency records in the simulator so an application or simulator
restart does not silently allow a second refund. Retrying the same operation uses
the same key and payload. A different payload with that key is a conflict. A new
operator action must not bypass an unresolved earlier operation.

For duplicate or out-of-order events, verify the signature, record the receipt,
and apply a permitted state transition in one transaction. Query the simulator
when needed to resolve ambiguous status; never overwrite `succeeded` with an
older `processing` event. Preserve provider identity and operation correlation.

A reset replaces only this project's explicitly disposable demo data, including
the paired simulator ledger. Require environment and database identity checks;
do not truncate an arbitrary database given through a connection string.

## Milestones

### 1. Foundation and return request

- [ ] Scaffold web/API/PostgreSQL and initial migrations.
- [ ] Add synthetic sessions and seed orders for two merchants.
- [ ] Build order lookup within the customer session and submit a partial return.
- [ ] Show that request in the authorized merchant's operator queue.
- [ ] Record verified local setup, migration, seed, development, and check commands.

Done when the customer can request a valid return and the server rejects excess
quantities, an expired window, and another customer's order.

### 2. Approval and warehouse inspection

- [ ] Build the return detail screen, decision reasons, and item history.
- [ ] Add support approval/rejection and warehouse receipt/inspection actions.
- [ ] Validate transitions and permissions on the server.
- [ ] Protect concurrent decisions and overlapping requests for the same units.
- [ ] Commit audit entries with their corresponding business state changes.

Done when a partial return reaches a finance-ready state and two requests cannot
reserve or refund the same order units through a race.

### 3. Refund submission and recovery

- [ ] Add the independent local payment simulator and its inspectable ledger.
- [ ] Add refund intent, transactional outbox, worker, and stable idempotency keys.
- [ ] Support provider status lookup and recovery from an unknown result.
- [ ] Verify signed simulator events and deduplicate receipt/business writes.
- [ ] Show refund history, failure details, and a safe recovery action in the UI.

Done when a response can be lost after provider success, the app and simulator can
restart, and recovery still leaves one financial refund in the simulator ledger.
The guarantee depends on the adapter/provider contract; do not claim universal
exactly-once behavior across external payment systems.

### 4. Focused verification and interface quality

- [ ] Test policy boundaries, minor-unit arithmetic, totals, and repeated returns.
- [ ] Use PostgreSQL tests for concurrent decisions, outbox atomicity, and receipts.
- [ ] Test duplicate submission, lost acknowledgement, restart, and delayed events.
- [ ] Add browser journeys for a valid partial return and a blocked request.
- [ ] Check keyboard access, action confirmation, narrow layouts, and clear states.

Use a controlled clock and injected failures rather than slow sleeps. Validate
both application state and the independent simulator ledger. Keep correctness
checks separate from performance measurements.

### 5. Portfolio handoff

- [ ] Add a repeatable local scenario runner and scoped demo reset.
- [ ] Record an English walkthrough of roughly 90 seconds.
- [ ] Capture the return queue, decision history, and refund recovery screens.
- [ ] Write a case study explaining uncertain outcomes and the chosen transaction
  boundaries, including what the simulator does not prove.
- [ ] Rehearse setup from a clean checkout and publish actual commands and limits.

Public hosting is optional future work. The completed local simulation, recorded
demo, and readable evidence are the deliverables for this plan.

## Demonstration script

1. As a customer, request a return for one unit from a multi-unit order.
2. As support, review the policy and approve that unit with an explanation.
3. As warehouse staff, record receipt and a passing inspection.
4. Trigger a simulated provider success with a lost response, leaving an uncertain
   result visible to finance.
5. Recover using the same operation, show one provider ledger entry, and replay a
   duplicate signed event without changing the refund total.

## Relationship to the webhook project

This repository must run on its own with its own local simulator. A later optional
adapter can use the separate webhook service to deliver simulator status events.
Keep this integration behind a setting and a documented HTTP contract; do not
import another repository's internals or require sibling checkouts for setup.

## Scope boundaries and evidence

Exclude live payment credentials, a storefront, inventory procurement, shipping
labels, multi-currency accounting, chargebacks, exchanges, AI decision making,
and a general integration platform.

Success means the scenarios are repeatable, unauthorized actors cannot change
returns, the local financial invariants hold under injected failures, and the UI
explains each outcome. Report author-performed local checks, not customer savings,
production transaction volumes, or actual payment-provider certification.

## Development references

- [Vite setup](https://vite.dev/guide/)
- [Fastify TypeScript reference](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [Stripe idempotency semantics](https://docs.stripe.com/api/idempotent_requests)
- [Stripe webhook behavior](https://docs.stripe.com/webhooks)

Stripe's documentation is a reference for an optional future test adapter. The
local simulator has its own documented contract and is not a Stripe emulator.
