# Start the returns and refunds thread

Open `C:\Users\admin\repos\returns-and-refunds` as its own project and paste:

```text
We are building my returns-and-refunds portfolio project. Read README.md and
PLAN.md first. The repository currently contains planning documents only.

I am Kleiton, a senior engineer in Brazil targeting international remote roles.
This application should make a return and refund workflow understandable to
recruiters and give engineers concrete financial correctness and recovery behavior
to examine. All data is synthetic and testing is author-performed locally.

Implement milestone 1 as a complete vertical slice. Continue through its acceptance
criteria, verify the result, and update the plan to reflect what actually works.
Defer later milestones until I request them.

Use pnpm, strict TypeScript, React/Vite, Tailwind, TanStack Query, a small Node API,
and local PostgreSQL as the starting architecture. Keep inferred types and avoid
any, casting wrappers, a broker, or unnecessary deployable services. Check package
compatibility when scaffolding. Follow applicable Docker-through-WSL instructions
on this Windows machine if Docker is needed.

The eventual payment adapter must default to an independent local simulator.
No external accounts, real customers, payments, or hosting are required. Store
money in integer minor units, enforce permissions and state transitions on the
server, and keep this project runnable without the webhook repository.

Use only project-owned local services and data. Do not touch production or existing
daily-driver previews. Scope resets explicitly. Test meaningful business rules and
failure boundaries, and record actual local evidence without customer-impact claims.
```
