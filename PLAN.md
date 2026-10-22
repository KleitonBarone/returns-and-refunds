# Returns and refunds delivery plan

## Starting point and completion

On October 19, 2026, the repository contained planning documents only. Planning
started at `f5cd68a`, and the initial plan was merged through GitHub PR #1 as
`6448a3d`. The default branch is `main`. Application services, migrations, tests,
and CI were added through the implementation deliveries recorded below.

This plan contains the documentation delivery and nine implementation PRs with 23
proposed implementation commits. The PR labels below describe delivery order,
not assigned GitHub numbers. Record real PR numbers, commit hashes, check results,
and merge timestamps as work finishes, never invent them.

Execution is now authorized through the complete remaining plan, including
commits, pushes, draft PRs, checks, and actual merges. All nine implementation
deliveries merged through GitHub PR #11, with final verification on `d7a6ac0`.
The screenshot follow-up below replaces the original video at Kleiton's request.
Its own merge, checks, and release cleanup must be verified separately.

Build a local portfolio application for Kleiton, a senior engineer in Brazil
targeting international remote roles. Recruiters should recognize the commerce
workflow. Engineers should be able to inspect money calculations, authorization,
concurrent updates, transaction boundaries, and uncertain payment outcomes.

The product includes a customer portal, merchant queue, warehouse inspection,
and finance workflow for fictional orders. Its central demonstration follows a
partial return through approval, inspection, a successful simulated refund whose
response is lost, and recovery that leaves one refund in the provider ledger.

Completion means working local software, focused verification, repeatable
scenarios, a numbered English screenshot walkthrough, and a case
study, with every delivery PR merged into `main`. Public hosting is optional future
work. A merged PR does not imply a deployed site.

## Architecture and scope

- Use pnpm, strict TypeScript, React/Vite, Tailwind, TanStack Query, Fastify,
  PostgreSQL, Drizzle migrations, and ArkType at boundaries. Confirm compatible
  versions against official documentation in PR 1 and pin tools, dependencies,
  and the database image. Derive types rather than duplicating request shapes.
- Start with `apps/web`, `apps/server`, and `packages/contracts`. Keep domain rules
  and API/worker entry points in the same server codebase, with migrations under
  `apps/server/db`. Add `apps/simulator` in PR 4, `scripts` for scenarios, and
  `docs/evidence` for verification. Avoid unused packages and abstractions.
- Use a PostgreSQL outbox and worker, without a broker. The independent simulator
  exposes HTTP submission, status lookup, and diagnostics. It owns a separate
  persistent database and credentials. The application cannot read its SQL ledger.
- Use two project-owned PostgreSQL instances for the application and simulator,
  with separate credentials and volumes. Tests use disposable instances. No sibling
  checkout, paid account, external authentication account, or payment credentials
  are required.
- Use synthetic server sessions with a local persona picker. Seed support,
  warehouse, and finance users, two merchants, two customers in the primary
  merchant, and a customer in the second merchant. This is demo authentication.
- Reserve UI `4320`, API `4321`, simulator `4322`, and PostgreSQL `55432`. Verify
  availability before starting. Follow Docker-through-WSL instructions on this
  Windows machine. Name project containers, volumes, and databases explicitly.
  Do not stop existing services or borrow another project's preview or data.

Exclude live payments, a storefront, shipping labels, procurement, exchanges,
chargebacks, multi-currency accounting, AI decisions, and a general integration
platform. A Stripe test adapter and optional delivery through the separate webhook
project can follow later, behind settings and documented HTTP contracts. Keep
this repository independently runnable.

## Reliable development and test environments

Build the environment lifecycle in PR 1 and extend it as services arrive. Keep it
in small repository scripts and Compose configuration, not a general environment
management service. These contracts are implemented; current commands and
prerequisites are documented in README.md and HANDOFF.md.

### Setup and isolation

- Add `pnpm env:doctor` for read-only checks of pinned Node/pnpm versions, required
  configuration, WSL Ubuntu, the Docker endpoint and Compose, port availability,
  and free disk space. Once browser tests exist, check the pinned Chromium install.
  Report missing prerequisites precisely without installing global tools, changing
  Docker contexts, altering WSL settings, or printing secrets.
- Run Docker through WSL Ubuntu on this machine. Select one OS for Node, pnpm,
  and browser execution and document it; do not duplicate installs across Windows
  and WSL or share their `node_modules`. Verify actual host-to-WSL connectivity
  from the application process. Linux CI uses its own Docker transport with the
  same pinned dependencies, configuration contract, and test scripts.
- Give interactive development a stable project identity and persistent, explicitly
  named demo volumes. Give each integration/E2E run a unique identity such as
  `codex-returns-test-<run-id>`, fresh disposable databases/volumes, and assigned
  ports. Never reuse a developer database, daily-driver preview, or external volume.
  Two test runs must not collide with each other or development.
- Before creating resources, record the baseline and write a small run manifest
  under ignored `.local/runs/<run-id>`. Record ownership labels, Docker endpoint,
  Compose project/files, resource IDs, process identities, ports, temporary paths,
  and source SHA, without credentials. Record new resources as they are created,
  so a partial startup can be cleaned up. Labels and a stale PID alone are not
  sufficient proof that a resource or process is still owned by the run.
- Reuse the pinned PostgreSQL image and existing dependency/browser caches. Start
  separate app/simulator instances per environment, adding the second in PR 4.
  Set explicit container memory/CPU and
  connection-pool limits, then record measured settings adequate for these tests.
  Start with one browser worker; add concurrency only when measurements justify it.

### Startup and end-to-end checks

- `pnpm dev` supervises project services and prints their actual URLs and personas.
  Wait for database readiness, apply migrations, and create missing initial demo
  fixtures before API/web startup. Never reseed existing demo progress implicitly.
  Add simulator and worker readiness as those services arrive.
  Use bounded readiness probes for schema, seed, and service identity rather than
  sleeps or treating an open port as proof of readiness. Failed startup cleans up
  what it created and reports the failed dependency.
- `pnpm test:integration` owns its disposable PostgreSQL fixtures and any simulator
  processes it needs. `pnpm test:e2e`, introduced in PR 7, builds the current tree
  and starts a complete isolated web/API/worker/PostgreSQL/simulator environment.
  The runner owns startup, migrations, seed, checks, diagnostics, and teardown.
  Bind the browser's base URL to that run's manifest and reject unrelated services.
  Do not silently reuse an already-running web server.
- Pin Playwright with its matching Chromium browser for automated journeys. Run
  through the real UI, API, worker, database, and simulator HTTP contract without
  mocking refund persistence. Inspect the same isolated environment manually in
  the collaborative preview when diagnosing behavior, using a tab created for
  the task. Allow an explicit debug pause for this inspection, with cleanup when
  resumed or cancelled. Close that tab afterward. Keep automated runs headless.
- Cover customer request, support approval, warehouse inspection, finance refund,
  lost-response recovery, and the blocked cases already defined in the PR gates.
  Restart services while preserving that run's databases to prove recovery; only
  teardown afterward. Observe worker progress through explicit probes/barriers,
  including separate application and simulator ledger assertions.
- Local and CI runs use the same entry points, fixed fixtures/clock, timeouts, and
  financial assertions. Reproduce failures from the recorded source SHA and run
  configuration. Do not turn retries into proof that an intermittent failure is
  harmless. Preserve useful failure evidence before releasing resources.

### Cleanup throughout development

- Register cleanup before starting services, using `try/finally` and interruption
  handling, plus an always-run CI cleanup step. Supervise and stop child process
  trees, file watchers, workers, browser contexts, and run-owned proxy processes.
  Verify Windows cancellation behavior explicitly; do not rely on Unix signals.
  Use a bounded graceful shutdown, then terminate only processes whose ownership
  can still be verified. Never kill all Node/browser processes or kill by port.
- Test teardown uses the same Docker endpoint, explicit Compose project, and files
  as startup. Remove that run's containers, networks, and disposable volumes with
  scoped `down --volumes --remove-orphans`. Verify they are gone and ports released.
  Clean up after success, assertion failure, timeout, or interrupted startup. A hard
  kill may skip handlers; the next run reports unfinished manifests for recovery.
- Provide `pnpm dev:down` to stop project development processes/containers/networks
  while preserving demo volumes. Provide `pnpm env:clean` to inspect a specified
  abandoned run, preview its exact targets, and apply cleanup only after validating
  ownership and that it is inactive. Make reruns safe. Reused PIDs, active runs, and
  ambiguous resources must be refused and reported rather than guessed.
- Keep database reset separate from shutdown and temporary cleanup. Only the
  verified paired `pnpm demo:reset` flow may replace persistent demo data. Leave
  services running at handoff only when Kleiton requested a persistent preview;
  otherwise stop them and report any deliberately retained project demo volumes.
- Rotate container logs at 5 MiB per file with three files. Successful test runs
  replace the latest small result summary. Retain detailed logs, screenshots, and
  traces only for the latest failed run, capped at 100 MiB. Avoid routine video
  recording. Remove completed run directories after verified cleanup and evidence
  retention; preserve unfinished manifests until their resources are resolved.
  Report omitted oversized diagnostics. CI failure artifacts expire after seven
  days. Explicitly promoted portfolio evidence is preserved separately.
- Reuse dependencies across runs. Remove run-owned temporary reports, build output,
  rehearsal checkouts, and downloads when no longer needed. Resolve absolute paths
  and verify they are within the recorded temporary/workspace directories before
  removal. Preserve source, `.env`, the lockfile, workspace dependencies, promoted
  evidence, and pre-existing shared package/browser caches. Install only Chromium
  for the initial browser suite instead of downloading every browser engine.
- If image builds are needed, use a task-specific disposable Buildx builder without
  changing the default. Remove its exact builder/cache and task-created image tags
  afterward; remove newly pulled images only when no longer needed or used elsewhere.
  Avoid global Docker pruning, shared-cache pruning, stopping unrelated containers,
  WSL shutdown, and WSL disk compaction. Record intentionally retained image/cache
  dependencies so retained disk use is understandable.
- At each development handoff, report created/removed/retained resources and verify
  no task-owned processes, ports, containers, networks, disposable volumes, or
  builders remain. Check disk usage when pulling/building large images. Report
  cleanup failures as unfinished work; never turn a passing test into a clean
  completion report if its teardown failed.

Acceptance for the environment includes two consecutive isolated runs with the
same results, a deliberately failed/interrupted startup, and cleanup of an
abandoned run. Compare before/after resources and verify an unrelated marked
fixture and persistent demo data remain intact. These checks start in PR 1 with
the available services and expand to the complete stack in PR 7. PR 8's scenario
reset does not substitute for this earlier lifecycle work.

## Business and recovery contracts

These decisions resolve ambiguities before implementation. Changes require an
explanation in the affected PR and corresponding code, test, and plan updates.

### Eligibility, units, and money

- Use a 30-day window from stored `deliveredAt` UTC time. Accept through exactly
  `deliveredAt + 30 days`; reject later or future-dated deliveries. The server uses
  an injectable clock and snapshots the policy version, decision time, deadline,
  and selected unit values. Browser clocks never decide eligibility.
- Seed dates relative to a controlled demo clock. Display a fixed clock explicitly
  in the interface so seeded scenarios do not silently expire as real time passes.
- Use integer minor units and one currency per order. Store each purchased unit's
  allocated net merchandise value, distributing discount remainders deterministically
  so unit values sum to the line value. Validate safe integer ranges. Exclude
  shipping refunds, tax calculation, and currency conversion. Reject zero refunds.
- Customers select line quantities; the server reserves underlying unit identities.
  Reject empty selections, invalid quantities, unowned lines, and units already
  reserved or refunded. Previously refunded units remain permanently consumed.
- Lock the order before checking units or refund capacity. Use a consistent lock
  order and a database constraint preventing multiple active claims on a unit.
  Release claims on rejection or failed inspection. Keep historical claim records.
- Across an order, succeeded refunds plus unresolved refund intents cannot exceed
  its captured amount. Unknown outcomes keep their amount and units reserved.
  Never authorize a new refund by counting only successful earlier refunds.
- Retrying the same customer submission returns its original request. Reusing the
  request key with different content conflicts; it cannot reserve more units.

### Permissions and return transitions

Derive actor, merchant membership, and customer ownership from the server session,
never trusted request fields. Scope lists, detail reads, and mutations accordingly.
Customers access their own requests; support decides; warehouse staff receive and
inspect; finance submits and recovers eligible refunds.

1. Valid submission creates `requested` and reserves selected units.
2. Support approval moves `requested` to `approved`. Rejection closes the return
   with a persisted rejection decision/reason and releases its units.
3. Warehouse receipt moves `approved` to `received`.
4. Inspection records `inspection_passed` or `inspection_failed`. One verdict
   covers the request's units for the MVP; mixed verdicts are future work.
5. A failed inspection closes with an inspection-failure reason and releases units
   in the same transaction. Preserve the inspection result in history.
6. A passed inspection stays open until refund success closes it with a refunded
   reason and permanently consumes its units.

Use conditional updates or locked rows to reject competing/stale decisions. Audit
actor, reason, previous/resulting state, and correlation IDs in the business
transaction. A failed write must leave neither partial state nor a success entry.

Refund state is separate: `pending`, `processing`, `succeeded`, `failed`, or
`unknown`. A timeout means `unknown`. A confirmed terminal rejection means
`failed`; the MVP does not create a replacement operation for it. Its units remain
held pending a future explicit resolution flow. A retryable pre-write failure
retries the original operation rather than creating a new one.

### Payment processing and events

- Persist one refund operation per return with immutable amount, currency,
  merchant, payment reference, stable idempotency key, and payload fingerprint.
- Commit its capacity reservation, audit entry, and outbox job in one transaction
  before contacting the provider. Never hold that transaction across HTTP.
- Claim jobs with a bounded lease and ownership token, persist attempts/backoff,
  reclaim dead workers' jobs, and prevent stale workers from overwriting a newer
  attempt. Repeated HTTP submissions must use the same key and payload.
- The simulator atomically persists idempotency records and ledger entries. The
  same key/payload returns the existing operation; different content conflicts.
  Records survive simulator and application restarts until an explicit demo reset.
- Simulator controls cover success, terminal rejection, retryable failure before
  the financial write, success with a dropped/delayed response, and duplicate or
  delayed signed events. Persist scheduled deliveries and keep controls local.
  Sign each delivery at send time, separately from the event's occurrence time,
  so delayed events remain verifiable while stale delivery signatures are rejected.
- Status lookup works by the stable key even when no provider receipt reached the
  application. Recover unknown outcomes through lookup and, where the contract
  permits, resubmission with that same key. A finance click cannot bypass an
  unresolved operation with a new one. Unavailable lookup preserves uncertainty.
- Verify signed events over raw bytes with timestamp tolerance. Validate provider,
  merchant, operation, amount, and currency. Persist the unique provider/event
  receipt and business effects atomically before acknowledging delivery. Unmatched
  events cannot create financial operations.
- Duplicate events have no repeated business/audit effect. Older `processing`
  events cannot downgrade success. Resolve contradictory terminal events through
  provider lookup rather than trusting arrival order.
- Expose an inspectable simulator ledger through a diagnostic endpoint. Compare
  application state with that independent ledger in tests and demo evidence.

These guarantees depend on the simulator contract. Do not claim universal
exactly-once behavior across external payment systems. A later adapter must define
its own idempotency retention, lookup, and event behavior.

## PR sequence and proposed commits

Execute sequentially from latest merged `main`, without a speculative stack.
Each numbered item below is a proposed commit subject, using the repository's
existing plain descriptive style. Fix commits depend on actual review findings.
Adjust commit boundaries only when it makes the real change easier to review.

### PR 0. Complete this delivery plan

Branch: `docs/complete-delivery-plan`.
PR title: `Complete the returns and refunds delivery plan`.

1. `Complete the returns and refunds delivery plan`

Expand this plan with contracts, PRs, commits, checks, and push/merge steps. Align
README and the handoff. Verify local links, coverage, and the diff. Open a draft
documentation PR, register it with T3, mark it ready after review, and actually
merge it. Verify GitHub and local/remote `main`. Do not claim application tests.

### PR 1. Establish the local foundation

Branch: `feat/local-foundation`.
PR title: `Add the local application foundation`.
Depends on PR 0.

1. `Set up the typed web and server workspace`
2. `Add isolated PostgreSQL setup and initial migrations`
3. `Add reproducible environment checks and scoped teardown`
4. `Document development commands and add CI checks`

Create the web/API shell, validated configuration, health/readiness endpoints,
local proxy/origin rules, and merchant/user/membership/customer/order/line/unit
schema. Add migrations, deterministic seed data, application identity markers,
`.env.example`, pinned tools, and the lockfile. Keep services bound locally.
Implement the environment manifest, preflight, process supervision, isolated test
resources, and cleanup commands defined above before routine verification begins.

Add root scripts `pnpm check`, `pnpm test`, `pnpm test:integration`, `pnpm build`,
and `pnpm dev`. `check` covers types, lint, and formatting. Later PRs add meaningful
suites to these commands. CI uses disposable PostgreSQL, applies migrations, and
runs the checks and build. Initial suites verify configuration rejection and
database constraints, without placeholder success tests.

Merge gate: clean install, migration, seed, database readiness, startup, and CI
work on isolated resources. Check migration/seed reruns and record the actual
commands, selected versions, ports, and Windows/WSL prerequisites.
Demonstrate repeatable integration runs, failed/interrupted startup cleanup,
preserved development data, and absence of leftover run-owned resources. Record
baseline/remaining resources and validate the intended Windows/WSL workflow.

### PR 2. Deliver customer requests and the merchant queue

Branch: `feat/customer-return-requests`.
PR title: `Let customers request partial returns`.
Depends on PR 1. Completes original milestone 1.

1. `Add demo sessions and customer order access`
2. `Create eligible return requests with unit reservations`
3. `Show customer requests in the merchant queue`

Implement persona switching, scoped order lookup, policy snapshots, request/item
storage, active claims, submission deduplication, and transactional audit. Build
quantity/reason selection, confirmation, customer status, and the merchant queue
with loading, empty, blocked, and error states.

Merge gate: a valid partial request appears for its merchant. Test UTC boundaries,
future delivery dates, minor-unit allocation, invalid quantities, another customer,
cross-merchant access, repeated submission, and concurrent overlapping requests
against PostgreSQL. Only one competing request can claim the same units.

### PR 3. Complete decisions and warehouse inspection

Branch: `feat/return-decisions`.
PR title: `Add return approval and warehouse inspection`.
Depends on PR 2. Completes original milestone 2.

1. `Add authorized decisions and inspection transitions`
2. `Show return history and role-specific actions`

Add decision/inspection storage, return details, actor/reason history, approval,
rejection, receipt, pass/fail inspection, and finance readiness. Commit transition,
audit, and claim release atomically. Explain conflicting operator actions.

Merge gate: a return reaches `inspection_passed`; rejection and failed inspection
close with explicit reasons. Test permissions, allowed/forbidden transitions,
competing decisions, rollback, released claims, and previously consumed units.
Verify the customer and authorized operators can follow the result.

### PR 4. Add the persistent payment simulator

Branch: `feat/payment-simulator`.
PR title: `Add a persistent local refund simulator`.
Depends on PR 3.

1. `Add refund submission and lookup to the local simulator`
2. `Add persistent failure controls and signed simulator events`

Implement the small adapter contract, separate migrations, captured-payment seeds,
durable key/payload records, ledger, lookup/diagnostics, failure controls, and
persistent signed event delivery. Enforce merchant/payment identity and capture
limits inside the simulator. Document the HTTP contract and reset boundary.
Extend the environment runner with simulator migration/seed, readiness, correlated
diagnostics, and teardown without granting app SQL access to the provider ledger.

Merge gate: direct contract tests prove same-key replay, conflicting payloads,
concurrent submission, capture limits, terminal rejection, retryable pre-write
failure, success with lost response, and restart persistence. Count ledger entries
independently. Verify event generation here; application consumption is PR 6.

### PR 5. Submit refunds through the outbox

Branch: `feat/refund-processing`.
PR title: `Process refunds with durable operations and an outbox`.
Depends on PR 4.

1. `Create authorized refund intents with atomic outbox writes`
2. `Process refund operations with durable worker leases`
3. `Show refund submission and operation status`

Add operations, provider receipts, jobs, attempts, keys, and finance submission.
Check inspection readiness, per-return uniqueness, and order-wide reserved amounts
under the order lock. Implement worker lifecycle, lease expiry, retry timing, and
fenced writes using the real simulator HTTP adapter. Add amount confirmation and
basic status/error feedback. Unknown outcomes remain visible/reserved until PR 6.

Merge gate: operation/outbox/audit rollback together; competing submissions create
one intent; overlapping refunds cannot exceed capture; dead workers' jobs recover;
duplicate delivery creates one ledger refund. Lost responses become `unknown`,
terminal rejection becomes `failed`, and success atomically closes the return and
consumes its units.

### PR 6. Recover uncertain outcomes and consume events

Branch: `feat/refund-recovery`.
PR title: `Recover uncertain refunds without issuing duplicates`.
Depends on PR 5. Completes original milestone 3.

1. `Recover unknown refunds through stable operation lookup`
2. `Apply signed provider events with atomic receipt handling`
3. `Expose refund history and safe finance recovery actions`

Add same-operation recovery, signed receipt handling/deduplication, guarded refund
transitions, contradictory-event lookup, and finance history. Explain checking
status versus retrying the same operation. Terminal rejection cannot be blindly
retried. Concurrent recovery clicks refresh the same operation.

Merge gate: lose a response after provider success, restart API/worker/simulator
without resetting data, and recover one ledger refund. Cover the crash between
provider success and application acknowledgement, duplicate/delayed events, invalid
signatures/timestamps, mismatched merchant/amount/operation, and event/API races.
Unavailable lookup retains `unknown`; success never regresses. Assert both ledgers.

### PR 7. Finish the interface and browser journeys

Branch: `feat/operations-interface`.
PR title: `Finish the customer and operator workflows`.
Depends on PR 6. Completes original milestone 4 with earlier correctness tests.

1. `Refine queue navigation and return recovery feedback`
2. `Verify accessible customer and operator journeys`

Refine queue filters, navigation, next actions, readable amounts/times, histories,
confirmations, keyboard focus, labels, and narrow layouts. Explain retryable,
terminal, and unknown outcomes and the synthetic environment without putting
database or worker details into product flows.

Merge gate: browser journeys cover the full partial return with recovery and an
expired request. Add only distinct extra journeys as needed. Inspect keyboard-only
completion, desktop/narrow layouts, in-flight actions, validation, and service
errors. Save screenshots and actual results on isolated local demo data.
Introduce the self-contained `pnpm test:e2e` runner defined above, use its full
stack in local and CI checks, and inspect it manually through the task preview.
Two fresh runs must pass, a deliberate failure must retain bounded diagnostics,
and interruption/abandoned-run cleanup must release the complete test environment.

### PR 8. Make scenarios and reset repeatable

Branch: `feat/repeatable-demo`.
PR title: `Add repeatable scenarios and a scoped demo reset`.
Depends on PR 7.

1. `Add deterministic demo scenarios and isolated reset checks`
2. `Record financial and recovery verification evidence`

Add `pnpm demo:run`, `pnpm demo:verify`, and `pnpm demo:reset`. Seed normal,
expired, inspection-failure, retryable, unknown, previously-returned-unit, and
second-merchant cases. Use controlled clocks/failure barriers rather than sleeps.
Record operation IDs, app amounts, provider ledger counts, and event outcomes
with tool versions, excluding credentials and session tokens.

Reset quiesces project workers/deliveries, verifies both configured database
identities, paired environment, and disposable-demo markers before any writes,
then replaces only project demo data including the simulator ledger. Refuse
arbitrary connection strings. Fail visibly if a paired reset is incomplete.

Merge gate: two reset/seed/demo runs produce equivalent financial assertions.
Unmarked disposable fixtures fail reset checks before modification. Verify restart
recovery separately from reset so clearing a ledger cannot hide duplicates.
Use the existing environment lifecycle; keep repeatable demo reset separate from
automatic test teardown, development shutdown, and failed-run artifact cleanup.

### PR 9. Publish the portfolio handoff and verify main

Branch: `docs/portfolio-handoff`.
PR title: `Document and demonstrate the completed returns workflow`.
Depends on PR 8. Completes original milestone 5.

1. `Add the walkthrough and refund recovery case study`
2. `Verify clean-checkout setup and close the delivery plan`

Replace README's planned setup with verified prerequisites and commands. Add
screenshots and architecture/transaction explanations. The original video
demonstration was delivered, then superseded by Kleiton's screenshot-only request
on October 22. The current demonstration is a numbered English screenshot guide
captured through the existing full-stack browser journey.

Write the case study with actual local evidence and simulator limitations, without
customer-impact or provider-certification claims. Update the handoff and delivery
status. Hosting remains optional and requires separate scope.

Merge gate: rehearse install, migration, seed, checks, demo, and shutdown from a
separate clean checkout with its own ports/databases. Verify media links and the
final acceptance list. After merge, check the final remote SHA in a clean checkout
and rerun final checks there. Report blockers instead of claiming completion.
Include environment recovery/cleanup instructions and retained disk-use details
in the handoff. Remove task-owned rehearsal resources after recording evidence.

## Commit, push, review, and merge protocol

Apply this to every PR, including PR 0. Preserve the repository's plain descriptive
subjects. A commit alone, a pushed branch, or an open PR is not a completed delivery.

1. Inspect status and active Git operations; preserve unrelated work. Fetch origin,
   fast-forward local `main`, and create the planned branch. Confirm the next scope
   against current docs and merged PRs.
2. Implement the slice and relevant tests. Inspect each diff and stage explicit
   paths. Commit logical changes with their migrations, lockfiles, and docs.
   Use the environment lifecycle for verification from PR 1 onward and confirm
   teardown after each run, including failures, before claiming its checks passed.
3. Before opening, fetch and merge latest `origin/main` into the branch. Resolve
   conflicts and rerun affected checks on that tree. Incorporate latest main even
   when the branch was originally created from main; avoid rewriting pushed history.
4. Push with `git push -u origin <branch>`. Check for an existing PR first. Create
   a draft against `main` using its planned title, a short problem/solution, actual
   validation, and material limits. Use a body file for multiline text. Immediately
   register the real URL through T3's `link_pull_request` and record it in the log.
5. Inspect CI and reviews on the latest pushed head. Verify bot findings against
   source, fix real defects, and explain false positives. Gather unresolved human
   comments for Kleiton's input. Never bypass checks or review requirements. Use
   T3's watcher if waiting is needed, and resume on its notification.
6. Commit/push necessary fixes and rerun affected checks. Inspect new findings.
   If main advances, merge it again, push, and verify the new head before merging.
7. After the PR's gate and repository requirements pass, mark it ready. When the
   execution run authorizes merging, actually merge on GitHub with a merge commit
   preserving the implementation commits. Use
   `gh pr merge <url> --merge --match-head-commit <reviewed-sha>` without admin
   bypass. Otherwise request authorization for the concrete reviewed PR. This
   planning delivery includes the authorized documentation PR merges.
8. Verify GitHub reports `MERGED` and a merge SHA. Fetch, fast-forward local main,
   confirm that SHA is contained in `origin/main`, and perform the relevant
   post-merge check. Keep a clean worktree. Clean up only merged task branches if
   needed. Do not push directly to main to simulate a PR merge.
9. Record real PR URLs, commit SHAs, validation, and merge results. Stop any T3
   watcher when handing back and confirm every worked-on PR is linked to the
   thread. Start the next implementation branch only after the previous PR merges.
   Report cleanup and retained resources at handoff; release disposable resources
   before starting another PR so successive slices do not accumulate environments.

Use the PR title for its merge commit. Fix-commit subjects and counts depend on
observed issues. A changed head or new failure needs fresh evidence; repeated green
smoke checks without a new reason do not.

## Verification and evidence

The following scripts exist. The delivery labels record when they were introduced:

- PR 1 onward: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm test`,
  `pnpm test:integration`, `pnpm build`, `pnpm env:doctor`, `pnpm dev`,
  `pnpm dev:down`, and scoped `pnpm env:clean`, plus documented database commands.
- PR 2 onward: pure policy/money tests and real PostgreSQL tests for isolation,
  unit claims, permissions, concurrent decisions, and business/audit atomicity.
- PRs 4-6 onward: HTTP contract tests, independent persistent-ledger assertions,
  outbox leases/retries, crash windows, unknown outcomes, and signed receipts.
- PR 7 onward: `pnpm test:e2e` on isolated services/data. Browser journeys prove
  user flows; they do not replace database race tests.
- PR 8 onward: `pnpm demo:run` and `pnpm demo:verify` produce evidence independently
  of the explicitly destructive, scoped `pnpm demo:reset` command.

Inject clocks, worker stepping, and network failure points. Use separate PostgreSQL
connections and explicit transaction barriers for races, avoiding slow sleeps.
Check upgrades from the previous schema when migrations change persisted data.
CI must exercise real PostgreSQL and simulator behavior where needed.

Every feature PR includes its correctness checks immediately. PR 7 adds browser
and interface coverage; PR 8 assembles repeatable evidence. Neither defers earlier
financial or authorization correctness. Keep tests focused on behavior and failure
boundaries. Distinguish demonstrated infrastructure flakes from product failures.

## Demonstration script

1. Introduce the fictional merchant and local demo environment.
2. As a customer, return one unit from a multi-unit order. Show its amount and
   remaining eligible quantities.
3. As support, review the policy snapshot and approve with a reason.
4. As warehouse staff, record receipt and a passing inspection.
5. As finance, confirm the amount. The simulator records success and drops the
   response, leaving a visible `unknown` result.
6. Restart services without clearing data. Recover the original operation, show
   one provider ledger entry, and replay a duplicate event without changing funds.
7. End on decision/refund history and the documented simulation limits.

Other scenarios cover expired requests, failed inspection, retryable failure,
wrong customer/merchant, and delayed status events.

## Milestone mapping

The original five milestones remain covered. PRs 1-2 deliver the foundation and
return request; PR 3 delivers approval and inspection; PRs 4-6 deliver refund
submission and recovery; PR 7 completes interface/browser verification alongside
the earlier feature tests; PRs 8-9 deliver repeatable evidence and portfolio handoff.

## Delivery log

Delivery PR 0 was [GitHub PR #1](https://github.com/KleitonBarone/returns-and-refunds/pull/1),
on `docs/complete-delivery-plan` from `f5cd68a`. Commit `d890dfc` passed documentation
structure/link/whitespace checks and merged as `6448a3d` on October 19, 2026.
The environment/cleanup refinement was [GitHub PR #2](https://github.com/KleitonBarone/returns-and-refunds/pull/2),
commit `7b2fa99`, merged as `2992d18` after documentation checks.
GitHub's merged PR record is authoritative; this file cannot contain its own
future merge SHA.

Deliveries 1-8 are merged; delivery 9 is the final handoff. During each delivery PR, add its URL, branch, included
commits, and actual checks here. Include
prior merge metadata in the next log update. Do not create another PR merely to
record this documentation PR's merge SHA.

### Implementation delivery 1. Local foundation

Branch `feat/local-foundation` adds the typed workspace, initial migration and
seed, real database/API checks, isolated environment runner, scoped cleanup,
and CI. The environment runner also handles this machine's exhausted automatic
Docker pools by selecting a free subnet without modifying existing networks.
Live preview verification also exposed WSL idle shutdown stopping PostgreSQL.
The runner now owns a WSL session for the run and releases it after Docker
teardown, with bounded connection waits and useful API error diagnostics.

Local evidence on October 20, 2026: Node 24.20.0, pnpm 11.23.0, WSL Ubuntu,
Docker 29.8.0, Compose 5.5.1, PostgreSQL 18.1 pinned by digest. Type/lint/format
checks, two unit checks, three real PostgreSQL checks, and the Vite build pass.
Lifecycle verification passed two fresh runs, preservation across migration/seed
reruns, real HTTP identity readiness, injected startup failure, abrupt supervisor
termination, abandoned-run cleanup, and preservation of unrelated fixture/network
resources. The temporary sentinel volume and all disposable run resources were
removed. The PostgreSQL image and installed workspace/package dependencies remain
available for subsequent implementation work.

[GitHub PR #3](https://github.com/KleitonBarone/returns-and-refunds/pull/3) merged as
`0596abf` after CI passed on `d8173cc`. Included commits: `1f1225e`, `c00ac8e`,
`65ac104`, `b6260b7`, and `d8173cc`.

### Implementation delivery 2. Customer requests

Branch `feat/customer-return-requests` adds scoped demo sessions, customer orders,
partial returns, stored policy/unit values, transactional claims and history, and
the customer/support interface. The API, schema, contracts, and correctness tests
form one commit because they depend on one another; the interface and evidence
form the next commit. This combines the first two proposed subjects.

Local evidence on October 21, 2026: type/lint/format checks, four unit checks,
nine PostgreSQL checks, and the production web build pass. Tests cover exact UTC
deadlines, future delivery, integer allocation, invalid quantities, ownership,
merchant/role isolation, repeated submissions, consumed units, and two requests
blocked concurrently on the same order lock. Only one claims the selected units.

Browser verification created a $35 partial request, opened its policy/history in
Ava's queue, confirmed Robin's separate merchant queue stayed empty, and checked
the expired order's disabled form. Evidence is saved in
[the original customer capture](https://github.com/KleitonBarone/returns-and-refunds/blob/d7a6ac0f54e43c4b198a52d9468a5d18258c6021/docs/evidence/screenshots/customer-request.jpg). The preview processes,
container, and network stopped with verified teardown. Its project-owned demo
volume remains available; disposable test resources were removed.
[GitHub PR #4](https://github.com/KleitonBarone/returns-and-refunds/pull/4) includes
commits `c419026` and `3f22f7c`. CI passed on `3f22f7c`; it merged as `73c0669`
on October 21, 2026.

### Implementation delivery 3. Decisions and inspection

Branch `feat/return-decisions` adds server-authorized support decisions, warehouse
receipt and inspection, persisted review outcomes, closure reasons, confirmation
forms, and ordered actor/reason history. All unit-affecting actions lock the order
before the return. Failed inspection records both its verdict and closure in the
same transaction. Audit sequence ordering keeps a fixed demo clock deterministic.

Local evidence on October 21, 2026: type/lint/format checks, four unit checks,
15 real PostgreSQL checks, and the production build pass. New checks cover the
complete passing flow, rejection and released claims, failed inspection while a
previously consumed unit stays unavailable, roles/merchant/state guards, two
competing decisions waiting on the order lock, and rollback after an injected
audit constraint failure. The rollback leaves state, reviews, history, and claims
unchanged.

The retained demo data migrated successfully. Browser verification carried the
existing $35 request through support approval, warehouse receipt, and passing
inspection, then verified finance readiness and the customer's ordered history.
Evidence is in [the original inspection capture](https://github.com/KleitonBarone/returns-and-refunds/blob/d7a6ac0f54e43c4b198a52d9468a5d18258c6021/docs/evidence/screenshots/inspection-passed.jpg). A 390px DOM
check showed the detail contained within the viewport; narrow screenshot capture
timed out, so complete responsive visual review remains in delivery 7. The browser
size was restored, its task tab closed, and preview teardown verified. Test
resources were removed; the project demo volume remains for subsequent work.
[GitHub PR #5](https://github.com/KleitonBarone/returns-and-refunds/pull/5) includes
commits `3e60cb8` and `4aaaf0b`. CI passed on `4aaaf0b`; it merged as `d6e868d`
on October 21, 2026.

### Implementation delivery 4. Persistent payment simulator

Branch `feat/payment-simulator` adds a separate PostgreSQL cluster, provider HTTP
contract, idempotency/capture checks, independent ledger, failure controls, signed
event scheduling and leased delivery. The supervisor migrates/seeds and probes it,
tracks its process and ports, and tears down both databases. Application child
processes receive neither provider SQL nor control credentials. The local inspect
and control commands verify the running checkout before accessing diagnostics.

The first commit groups simulator transport, persistence, events, and their
contract tests because receipt/ledger/event scheduling is one transaction. The
second adds process-restart verification, local control commands, and documentation.

Local evidence on October 21, 2026: type/lint/format checks, four unit checks,
29 PostgreSQL/HTTP integration checks, and the production web build pass.
Simulator tests compare its own ledger for replay, conflicts, concurrent keys,
capture limits, rejected and retryable operations, rollback when event storage
rejects a write, dropped/delayed responses, restart persistence, delayed signed
duplicates, failed-delivery backoff, and stale
sender fencing. SQL/control isolation is verified. Full contract details and
limits are in `docs/payment-simulator.md`.

Lifecycle verification passed two fresh paired environments, preserved app/provider
state through migration/seed reruns and actual simulator process restart, and
removed both databases plus simulator processes after success, injected startup
failure, and abrupt supervisor termination. Unrelated fixtures/networks survived.
Development startup and the inspect/control commands also passed; the control
was restored to success afterward. Shutdown retains only the two project demo
volumes for subsequent development. The pinned PostgreSQL image is reused.
[GitHub PR #6](https://github.com/KleitonBarone/returns-and-refunds/pull/6) includes
commits `d851f6c`, `4a57397`, and `fc888ac`. CI passed on `fc888ac`; it merged as
`dddeca0` on October 21, 2026.

### Implementation delivery 5. Durable refund processing

Branch `feat/refund-processing` adds finance authorization and exact amount
confirmation, one immutable operation per return, transactional capacity checks,
an outbox, persisted attempts, and leased worker ownership. Confirmed success
atomically stores the provider receipt, acknowledges the job, records history,
closes the return, and permanently consumes its units. Unknown and failed
operations remain reserved without allowing replacement operations.

Commit `42d6699` combines the proposed intent and worker commits with their
contracts and integration checks because they share the new schema and financial
transaction boundaries. Commit `5ccfd73` adds supervised worker readiness and
actual crash/restart verification. The interface and documentation form the next
commit. Processing details and current recovery limits are in
`docs/refund-processing.md`.

Local evidence on October 21, 2026: type/lint/format checks, four unit checks,
42 real PostgreSQL/HTTP integration checks, and the production web build pass.
New checks cover finance/merchant/inspection/amount guards, concurrent submission
and capacity reservations, pre-write retry backoff, lost responses, terminal
failure, mismatched receipts, reclaimed leases and stale completion fencing.
Injected audit failures prove intent/outbox rollback and atomic success rollback.
An explicit provider barrier proves no order transaction spans HTTP.

Lifecycle verification passed two fresh environments with a real worker killed
after the simulator's financial write and before application acknowledgement.
A replacement reclaimed the original job, leaving one provider ledger entry,
one success audit, and abandoned/succeeded attempts. Actual simulator restarts,
failed startup, abrupt supervisor termination, abandoned-run cleanup, and
preservation of unrelated fixture/network resources also passed.

Browser verification migrated the retained demo data, confirmed the $35 refund
as Sam, observed automatic success and closure, and opened the same receipt and
history as Maya. The simulator diagnostics independently showed one $35 entry.
The inspected screenshot is [the original refund capture](https://github.com/KleitonBarone/returns-and-refunds/blob/d7a6ac0f54e43c4b198a52d9468a5d18258c6021/docs/evidence/screenshots/refund-succeeded.jpg).
The task tab closed; development shutdown verified removal of services, worker,
containers, and network. Only the two project demo volumes remain. Disposable
test resources were removed. Remote PR/merge evidence follows in the next update.

[GitHub PR #7](https://github.com/KleitonBarone/returns-and-refunds/pull/7) includes
`42d6699`, `5ccfd73`, and `a379f89`. Its first CI run passed the application and
integration checks but exposed a Linux lifecycle issue after the worker crash.
The exited worker remained as a zombie PID with an empty command line, which
restart mistook for a changed live process. A disposable Linux reproduction
confirmed the cause. Process identity now recognizes zombie/dead states as
exited while preserving start-time and command-hash checks for live processes.
Fix commit `7a66e2a` passed the full lifecycle suite on Windows and a disposable
Linux reproduction using Node 24.20.0. Temporary reproduction tools, dependencies,
and source files were removed after verified teardown. CI passed on `7a66e2a`;
PR #7 merged as `29b0ad7` on October 21, 2026.

### Implementation delivery 6. Recovery and signed events

Branch `feat/refund-recovery` adds original-key status lookup, finance recovery
reasons/history, and explicit same-operation retry only after a verified missing
key. Unavailable or mismatched lookup keeps the refund reserved. A terminal
rejection cannot be retried or replaced. Return details read one consistent
database snapshot while asynchronous confirmations occur.

Commit `43554c2` combines the proposed recovery and event commits because both
use the worker's shared financial transition and atomic completion logic.
Signed callbacks validate raw bytes, delivery time, provider, merchant, key,
payment, amount, currency, and receipt identity. Unique event receipts commit with
business effects and audit. Terminal events use lookup before opening SQL
transactions, including contradictory events; delayed processing cannot regress
success. Duplicate deliveries have no repeated financial or audit effect.
Details and the deliberate terminal-lookup tradeoff are in
`docs/refund-recovery.md`.

Commit `93127e0` adds owned API restart/readiness and full service restart
verification. Commit `41c0c89` corrects a browser-discovered demo control issue:
event delay now covers processing as well as terminal events, so an immediate
processing callback does not hide the unknown-outcome scenario. Its HTTP contract
test verifies that no event sends early and duplicate events retain valid fresh
signatures. The interface, documentation, and captured evidence form the next
commit.

Local evidence on October 21, 2026: type/lint/format checks, four unit checks,
59 PostgreSQL/HTTP integration checks, and the production web build pass. New
checks cover finance/merchant isolation, unavailable and mismatched lookup,
missing-key retry, terminal rejection, raw signature/timestamp validation,
mismatched events, concurrent duplicate delivery, recovery/event races, stale
worker fencing, and contradictory terminal observations. Injected audit failures
roll back financial success, event receipts, job acknowledgement, and attempts.
Explicit barriers verify lookup does not hold an order transaction across HTTP.

Lifecycle checks passed two fresh environments with actual API, worker, and
simulator restarts after a successful provider write whose response was dropped.
Original-key lookup recovered one ledger refund, then delayed processing and
contradictory duplicate terminal deliveries left one success audit. Worker-crash
lease reclamation, failed startup, abrupt supervisor termination, abandoned-run
cleanup, and preservation of unrelated resources also passed.

Browser verification used the retained demo data, completed customer/support/
warehouse/finance actions, observed a reserved $50 unknown outcome, and recovered
it through finance status lookup. Maya saw the same receipt and recovery history.
Original screenshots are [unknown](https://github.com/KleitonBarone/returns-and-refunds/blob/d7a6ac0f54e43c4b198a52d9468a5d18258c6021/docs/evidence/screenshots/refund-unknown.jpg) and
[recovered](https://github.com/KleitonBarone/returns-and-refunds/blob/d7a6ac0f54e43c4b198a52d9468a5d18258c6021/docs/evidence/screenshots/refund-recovered.jpg); actual bounded provider diagnostics are in
`docs/evidence/refund-recovery-provider.json`. They contain one matching $50
ledger entry. Simulator controls returned to success, both task browser tabs
closed, and development shutdown verified teardown. Disposable test resources
were removed; only the two project demo volumes remain. Remote PR/merge evidence
follows in the next delivery update.

[GitHub PR #8](https://github.com/KleitonBarone/returns-and-refunds/pull/8) adds
the recovery interface and captured evidence in commit `feae866`, following
`43554c2`, `93127e0`, and `41c0c89`. Its check passed on `feae866` with no open
review findings. PR #8 merged as `8dae22a` on October 21, 2026.

### Implementation delivery 7. Interface and browser journeys

Branch `feat/operations-interface` adds queue search/status filters, short return
identifiers, narrow-screen selection/back navigation, next-action guidance,
consistent time and financial-state labels, confirmation focus, and recoverable
service errors. The persona selector preserves keyboard focus during its session
update, after browser testing exposed focus loss from native disabling.

The browser runner pins Playwright and Chromium, builds the app, and owns fresh
app/provider PostgreSQL instances, API, worker, simulator, web server, and browser
on disposable loopback ports. It checks actual run identity before testing and
records process identity for cleanup after supervisor death. Browser profiles and
crash data use owned temporary storage. Latest success/failure diagnostics
replace previous artifacts with a 32 MiB/100-file cap. Traces/video are disabled
to avoid recording session credentials; assertion reports, screenshots, accessible
page state, and bounded console errors provide failure evidence. CI installs the
matching browser and runs the same journeys and cleanup verification.

Commit `1bb4dc7` refines the interface and records manual desktop/narrow review.
Two fresh browser runs passed both journeys in 19.7 and 20.1 seconds, excluding
environment setup/teardown. They cover keyboard completion through all four
roles, real in-flight request controls, a $35 partial refund whose response is
lost, actual service restarts, original-key recovery, three late signed event
copies, customer history and remaining units, expiry, narrow navigation, empty
filters, a real API outage/retry, and second-merchant isolation.

Failure verification requires fresh assertion/page/console/screenshot diagnostics
from the injected failure, checks the retention cap and credential exclusion,
and verifies that failed run's teardown. Abrupt supervisor termination while
Chromium was open also passed abandoned-run cleanup, including the browser,
services, ports, databases, and profiles. The retained expected-failure evidence
uses about 62 KB. Test/browser controls use only owned disposable environments.
Manual inspection used the same isolated runner, closed its task tab, reset the
viewport override, and resumed tests before verified cleanup.

Type/format/lint checks, four unit checks, 59 PostgreSQL/HTTP integration checks,
and the production web build pass. Actual financial diagnostics and screenshots
are linked in `docs/evidence/browser-verification.md`. The full service lifecycle
suite also passed repeated startup, persisted app/provider progress, actual
worker-crash recovery, service restarts, failed startup, abrupt interruption,
abandoned-run cleanup, and preservation of unrelated Docker resources. All run
directories and disposable resources were removed. The two earlier development
volumes remain preserved, and the dedicated matching Chromium cache is retained
for reuse at about 441 MiB.

[GitHub PR #9](https://github.com/KleitonBarone/returns-and-refunds/pull/9) contains
`1bb4dc7` and `fa2f1cc`. Its first CI run passed the earlier checks but Chromium
aborted before browser journeys because its Unix socket path under the long
checkout directory exceeded the OS limit. A Linux reproduction with the pinned
Node/browser versions confirmed the exact failure. Unix browser data now uses
a short, private `/tmp/rr-<hash>` directory derived from run/workspace identity.
Configuration and cache paths stay inside it. Cleanup checks its owner marker
and canonical path, refuses mismatched ownership, and removes it after stopping
the owned browser. Failure and supervisor-death checks assert that storage is
gone. Windows keeps its owned storage under the run directory. Both browser
journeys passed in two fresh Linux runs, and Linux failure, ownership-refusal,
and interruption verification passed. Windows storage/interruption checks also
passed. Temporary Linux tools, dependencies, browser cache, and source checkout
were removed after verified teardown. Type/lint/format checks pass. Updated CI
and merge evidence follow after the fix push.

GitHub PR #9 passed its complete check on `39aa84c`, including the Linux browser
and cleanup checks, without reviews or inline findings. It merged at
`2026-10-21T18:56:08Z` as `7aae390e0db5a6c204384990d074441ffeaa8918`.
Local main was fast-forwarded and the merge was verified in `origin/main` before
starting `feat/repeatable-demo`. The watcher was stopped after merge.

### Implementation delivery 8. Repeatable scenarios and guarded reset

Branch `feat/repeatable-demo` adds `demo:run`, `demo:verify`, and `demo:reset`.
[GitHub PR #10](https://github.com/KleitonBarone/returns-and-refunds/pull/10)
passed its complete CI check on `ef15922`, with no reviews or inline findings.
It merged at `2026-10-21T19:21:43Z` as
`ba33d5732e7d10dca4d0ffba6660a15b42a20e35`. Local main was fast-forwarded and
verified before creating `docs/portfolio-handoff`; its watcher was stopped.
Commit `28f128f` contains the deterministic scenarios, additional demo-only
database markers, paired reset, command interface, refusal/partial-commit checks,
guide, and CI gate. Fresh startup exposed an initialization-socket readiness race;
both PostgreSQL probes now require TCP. Repeated Windows restarts exposed reused
PIDs in child history; service helpers use the latest identity and clear stopped
service pointers while retaining ownership checks.

Commit `0860c70` makes a stop wait for an active demo reset before cleanup takes
its child-process snapshot. This extra fix commit prevents scenario seeding from
launching services after cleanup has already started.
Commit `ef15922` records the financial, reset, and active-shutdown evidence.

The committed-source verification run
`codex-returns-test-5c7d8cb2-8b7f-44a7-927e-4bf0b417aa19` passed two equivalent
reset/seed/demo cycles. Each had three independent 3500 USD ledger entries, 7000
confirmed in the app and 3500 retained as unknown. Actual API, worker, and
simulator restarts recovered the same operation without altering any ledger row.
Three signed processing-event copies returned 200, produced one ignored receipt,
and left one business success audit. Inspection failure released units, consumed
units could not be returned again, expiry returned 422, and merchant isolation
returned 404. Four marker/pairing refusals preserved every row. A failure injected
between commits preserved the provider ledger and left a failed journal and
stopped services. Final teardown retained no disposable resources.

Local type/lint/format checks, four unit checks, 59 integration checks, production
build, full service lifecycle verification, both browser journeys, and browser
failure/ownership/interruption cleanup passed. The browser journeys took 19.4
seconds, excluding setup/teardown; retained expected-failure diagnostics totaled
62187 bytes. See [scenario verification](docs/evidence/repeatable-verification.md)
and [financial evidence](docs/evidence/repeatable-financial.json).

The active-reset shutdown check on source `0860c70` observed phase `resetting`
before the reset command had produced a result. A stop request waited for that
command to succeed, then removed the environment. Both processes exited zero;
verified cleanup at `2026-10-21T19:15:28.472Z` retained no disposable resources.
The [shutdown record](docs/evidence/demo-shutdown.json) preserves that result.
No workspace-owned container or network remained; only the two original retained
development volumes remained. Existing PostgreSQL and browser caches were reused.

### Implementation delivery 9. Portfolio handoff and clean-checkout acceptance

Branch `docs/portfolio-handoff` is
[GitHub PR #11](https://github.com/KleitonBarone/returns-and-refunds/pull/11).
It passed CI on `08206ba` with no review findings and merged at
`2026-10-21T23:39:50Z` as `d7a6ac0f54e43c4b198a52d9468a5d18258c6021`.

Commit `8d727a6` added the original README, handoff, architecture/transaction
explanation, recovery case study, and video demonstration. Commit `08206ba`
recorded the independent clean-clone rehearsal. The original video was verified
before publication; the screenshot follow-up replaces that presentation and
removes its recording code and published media. Historical source remains in
Git. The current [walkthrough](docs/walkthrough.md) uses screenshots and linked
financial evidence.

The fresh-clone rehearsal and final remote-main closure are recorded separately.
The [fresh-clone record](docs/evidence/clean-checkout.json) verifies source
`8d727a6` from the public remote. Frozen install reused 152 package-store entries;
the clone downloaded its own matching browser. All 15 commands passed, including
type/unit/build/integration/lifecycle/browser checks, reset/recovery verification,
one-shot migration/seed/demo, and assigned-port development startup/shutdown.
Its two browser journeys passed in 21.5 seconds. Expected browser-failure evidence
used 7 files and 62695 bytes; supervisor-death cleanup passed. Development shutdown
preserved the two new rehearsal volumes, then explicitly verified ownership before
removing those temporary volumes. No rehearsal process, container, network, or
volume remained. After merge, the exact remote `d7a6ac0` passed all 12 final
commands in that clone, including 4 unit tests, 59 integration tests, both browser
journeys, lifecycle/failure cleanup, reset/recovery, and one-shot demo. GitHub CI
also passed on the merged SHA. The clone, its cache, local media, and helper files
were removed. Original development volumes and reusable project caches survived.
The release's [historical final verification](https://github.com/KleitonBarone/returns-and-refunds/releases/download/portfolio-walkthrough-2026-10-21/final-verification.json)
records these results. Its anonymous download matched its published SHA-256.
All PR watchers were stopped and local main was clean.

### Follow-up. Replace recordings with a screenshot guide

Kleiton requested a screenshot-only presentation on October 22 and authorized
execution of the replacement plan. Branch `docs/screenshot-walkthrough` is
[GitHub PR #12](https://github.com/KleitonBarone/returns-and-refunds/pull/12), opened
as a draft with two logical commits. `824e129` removes the recording command,
caption helper,
timed pauses, video mode, and WebM retention. `Replace the video walkthrough with
screenshots` adds six numbered UI states plus narrow/error examples, capture
provenance, matching financial assertions, and revised documentation.

The curated capture run was
`codex-returns-test-5478370c-adaa-4092-ad92-94237bf4b795`. Both journeys passed in
20.3 seconds; nine inspected PNGs total 400551 bytes, below the 2 MiB budget.
The [capture record](docs/evidence/screenshot-capture.json) records source/code
hashes, image dimensions/hashes, test statistics, and verified cleanup. Its
[financial record](docs/evidence/screenshot-financial.json) confirms one $35
provider entry and one success audit after real restarts and three late-event
copies. Existing financial assertions remain intact. Superseded images are
removed from the current tree, with immutable links preserving earlier evidence.

The failure/abandonment verifier exited zero. Its deliberate failure produced
7 diagnostic files totalling 62003 bytes. Browser termination, mismatched-storage
refusal, complete abandoned-run cleanup, and preservation of unrelated resources
passed. Type/format checks also passed. Latest main was incorporated before
opening the draft; its final head must pass CI and reviews before merge.

After that merge, verify its exact remote SHA, remove the published MP4 and
recording-metadata assets, and update the existing release to point to the guide.
Preserve the historical final verification and publish a new
`screenshot-verification.json` for this delivery. Verify public access, remove
temporary captures/helpers, and confirm no project recordings or disposable
services remain. These post-merge actions are pending until actually performed.

## Final acceptance

Original implementation acceptance passed on `d7a6ac0`, recorded in the release's
`final-verification.json`. The screenshot follow-up preserves those results and
records its own merge/check/cleanup result in `screenshot-verification.json`.

- [x] All planned capabilities exist on remote main and all delivery PRs are
  merged, with their URLs, commits, and final checks accounted for.
- [x] A clean checkout runs with documented local prerequisites and no sibling
  repository, paid account, real credentials, or existing development environment.
- [x] A documented preflight and supervised startup produce an identifiable,
  ready environment. Full-stack browser checks use isolated fixtures and ports
  with real API/worker/PostgreSQL/simulator behavior locally and in CI.
- [x] Repeated runs, failed/interrupted startup, and abandoned-run recovery leave
  no run-owned processes, listeners, containers, networks, disposable volumes, or
  builders. Unrelated resources and persistent demo data survive cleanup.
- [x] Logs, traces, screenshots, CI artifacts, and temporary builds/checkouts have
  bounded retention. The handoff lists intentionally retained volumes/images/caches
  and verifies cleanup rather than hiding leftover resources after passing tests.
- [x] Customer, support, warehouse, and finance complete the partial-return flow
  with the correct amount, policy explanation, history, and recovery action.
- [x] Customer ownership and merchant/role isolation hold for reads and mutations.
  Competing requests/decisions/refunds preserve units, capture limits, and audit.
- [x] Lost responses and service restarts recover the original operation, leaving
  one financial refund under the documented simulator contract.
- [x] Duplicate, delayed, invalid, and mismatched events neither duplicate funds
  nor regress success. Unknown outcomes keep their reservations.
- [x] Reset refuses unmarked databases and changes only the paired disposable
  project environment. Repeated scenarios produce the documented assertions.
- [x] Desktop, narrow layouts, keyboard flows, and error states are inspected.
  Required checks and browser journeys pass on the final merged tree.
- [x] Verified README setup, screenshots, an English walkthrough, a case study,
  and scenario evidence are available and accurately describe local simulation.
- [x] No invented customer outcomes, production volumes, real-provider
  certification, application completion, or public deployment are claimed.

## References

- [Vite setup](https://vite.dev/guide/)
- [Fastify TypeScript reference](https://fastify.dev/docs/latest/Reference/TypeScript/)
- [PostgreSQL row locking](https://www.postgresql.org/docs/current/explicit-locking.html)
- [Docker Compose readiness](https://docs.docker.com/compose/how-tos/startup-order/)
- [Docker Compose teardown](https://docs.docker.com/reference/cli/docker/compose/down/)
- [Playwright web server ownership](https://playwright.dev/docs/test-webserver)
- [Playwright CI setup](https://playwright.dev/docs/ci)
- [GitHub PR merge requirements](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/merging-a-pull-request)
- [Stripe idempotency semantics](https://docs.stripe.com/api/idempotent_requests)
- [Stripe webhook behavior](https://docs.stripe.com/webhooks)

Stripe documentation informs a future adapter. The simulator has its own contract
and is not a Stripe emulator. Never touch production, live databases, or existing
daily-driver build/preview channels without explicit environment authorization.
