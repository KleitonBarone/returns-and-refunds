# Returns and refunds

A planned operations console for reviewing return requests, recording warehouse
inspection, and issuing refunds. The customer can follow the request while the
merchant can explain each decision and recover a failed refund.

The default environment uses fictional orders and a local payment simulator.
No merchant account, real customer, card, or movement of money is required.

**Status: planning only.** Application code and working installation instructions
have not been added. The [delivery plan](PLAN.md) covers nine implementation PRs,
their proposed commits, acceptance checks, pushes, reviews, and verified merges.
Use the [thread starter](THREAD_START.md) to begin the next delivery step in a
development conversation.

The planned demo follows a partial return through approval, warehouse receipt,
and a refund whose successful response is lost. Retrying the operation must keep
one refund in the simulator's ledger. Other seeded cases cover an expired return
window, a rejected inspection, and a duplicate payment event.

The starting architecture is React, TypeScript, Vite, Tailwind, TanStack Query,
a Node.js API and worker, and PostgreSQL. External providers stay behind a small
adapter. An optional Stripe test integration can be considered after the local
workflow works; it is not needed for the portfolio demonstration.

Verification will document author-performed scenarios, financial invariants, and
failure recovery. Any case study will distinguish simulator evidence from actual
provider behavior and customer outcomes.

The final handoff includes a repeatable local demonstration, screenshots, an
English walkthrough, and a case study. Public hosting is optional future work.
