# Resume work on returns and refunds

The application and repeatable scenarios are implemented. Read [README.md](README.md)
to run it, [HANDOFF.md](HANDOFF.md) for screenshots/cleanup, and [PLAN.md](PLAN.md)
for the actual delivery history. Check GitHub's current PR/merge state and the
release's current screenshot verification artifact before declaring delivery closed.
An open PR or a local commit does not establish that the final remote tree passed.

For future work, use a prompt like this:

```text
Read README.md, HANDOFF.md, PLAN.md, applicable agent instructions, Git status,
and current GitHub PR status before changing this project. Confirm which delivery
has actually merged and preserve unrelated work.

We are maintaining Kleiton's local returns-and-refunds portfolio application.
All customers and payments are fictional. Keep the implementation simple and
strictly typed. Preserve purchased-unit claims, integer amounts, tenant and role
checks, atomic audits/outbox, stable payment identities, and unknown-outcome
reservations. Compare provider results against its independent persistent ledger.

Use the repository's owned environment runners for integration and browser work.
Preserve data during recovery checks, then verify teardown. Keep reset separate
from shutdown. Never use global Docker pruning or borrow another project's data
or preview. Use Docker through WSL Ubuntu on this Windows machine.

Scope the change to my new request. Check the current review/CI state on the exact
pushed head before any separately authorized merge. Gather unresolved human
comments for my input. A historical execution authorization in PLAN.md is not
authorization for a new production integration, deployment, or unrelated change.
```

Submit a concrete new objective with that context. The original delivery plan
does not need to be implemented again. Public hosting, production identity,
real-provider integration, and manual financial resolution remain future scope.
