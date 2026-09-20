# PLAN-099 — Requirements v2 migration

## Authority and baseline

The user authorized an implementation plan and the start of incremental code
migration, with separate traceable commits. Requirements PR #1 was merged as
`8f4cf197cfb399914d06312193d9921c11b270e0`. The normative catalog remains
`requirements-catalog.md`; its 27 requirements are not replaced by this plan.

Implement through reviewed increments on topic branches. Do not claim v2
compliance or deploy unattended operation while acceptance/authority bypasses
remain. Merge authority follows the current user instruction below. This plan
is a durable continuation record; scheduled execution is recorded separately.

### Current authorization and review policy

Nikola explicitly authorized autonomous implementation and merging PRs after
review when there are no valid unresolved findings and applicable tests pass.
Copilot review remains preferred when it executes, but on 2026-09-17 Nikola
authorized an independent exact-head fallback after repeated accepted review
requests produced no pending or completed review. The current scheduled window
still requires a completed exact-head Copilot review; independent review only
supplements that gate. Nikola renewed autonomous work again on 2026-09-19 at
20:52:02Z.
The current unattended mutation deadline is `2026-09-20T20:52:02Z`
(23:52:02 Europe/Sofia). This supersedes all earlier cutoffs.
Stop unattended mutations then and preserve a handoff unless Nikola extends
or changes the instruction. No paid model spending or deployment is authorized.

After that handoff, Nikola explicitly requested continuation again. PLAN-106
records this direct continuation and its bounded scope; the same completed
Copilot review, test, separate-commit and expected-head merge gates apply.

- Request `copilot-pull-request-reviewer[bot]` through the GitHub review-request
  API; the login without `[bot]` is not the supported reviewer identity. An API
  success without a submitted review is not approval and must not stall useful
  implementation indefinitely.
- A completed Copilot review covering the exact candidate head is mandatory in
  the current work window. Independent GPT-6 Astra reviews at `high` or higher
  supplement it but do not replace it. Fix every valid finding, rerun applicable
  checks, and re-review the changed head. Silence or an accepted API request is
  not approval. A stuck request may be removed and re-added once as a bounded
  recovery; verify the actual submitted review afterward.
- Merge only the reviewed, tested head using an expected-head-SHA guard and a
  merge commit to preserve implementation history. Respect branch protection.
- Keep paid model spending and deployment out of scope. Existing free-provider
  synthetic tests are permitted; do not disclose credentials.
- Continuations must inspect current remote state before acting and avoid
  overlapping work. Claim a checked, bounded ownership marker and release it at
  handoff; marker age alone never proves that a live worker is dead. Scheduling
  details are recorded separately and do not guarantee execution tools or phase
  completion. Report concrete blockers.
- Group subsequent work into coherent phase PRs: remaining P2, then P3, etc.
  Keep separate logical commits for planning, reproductions, implementation,
  tests, documentation and review fixes. A new plan does not require a new PR.
- Prepare the next dependency-ordered unit while a PR is in review, using a
  separate branch for dependent changes. At most one PR is in review and one
  next unit is in preparation; do not merge before prerequisites are merged.
  Do not spend active work repeatedly sleeping or resending the same review
  request. A successful API response is not a completed review.
- Every delegated agent must use GPT-6 Astra (`gpt-6-astra`) with reasoning
  `high` or higher. If unavailable, work locally; do not silently downgrade.
- Report meaningful published commits in Bulgarian with commit links, purpose,
  validation and next action. Group related commits when necessary; do not make
  empty reporting commits or repeatedly announce an unchanged pending review.
- PRs #3-#22 are merged. The coherent remaining-P2 PR #22 merged on 2026-09-20
  as `55bfcc034cb0b570be144f549c040e731ee89e4c` after raw exact-head review
  commit-id verification for `95c5ea6fe0bdf2cc5ba5e84ca09866a2a68fece8`,
  resolved threads, two independent reviews and a full gate. P3 is reconciled
  with that result. PLAN-119 through PLAN-121 cover SCALER prompt admission,
  provider-envelope admission and exact Markdown-section retrieval. PLAN-122
  binds admitted file context to its source bytes across dispatch and result
  acceptance, including exact-output, symlink and non-regular-file boundaries.
  After its exact-head gate and reviews, reassess the remaining P3 acceptance
  matrix before selecting the next bounded unit; do not infer phase completion
  from these isolated components. PLAN-123 corrects first-request active-tool
  timing in the installed host, binds the selected definitions to a measured
  identity and fails closed on unsupported prompt composition. PLAN-124 adds a
  non-authorizing per-request route assessment over complete concrete
  provider-envelope evidence. It measures every route leg, requires explicit
  current-agent or worker/continuation roles, fails closed on malformed runtime
  evidence and records only compact advice. Route execution remains a later
  unit; neither PLAN-123 nor PLAN-124 is AC-08 completion.
  PLAN-125 first closes the isolated executor's result-acceptance prerequisite:
  child results become execution-bound proposals, only a successful parent-
  observed process outcome may close the request, and scheduled tool work is
  sequential. Replay approval is reserved atomically with the execution claim,
  stale finalizers preserve replacement ownership, and request closure is the
  last multi-index publication. Provider-envelope admission and route execution
  remain later units; PLAN-125 is not AC-08 completion. PLAN-126 bounds the
  isolated subprocess transport and compact serialized execution-bound result:
  raw-byte stdout/stderr caps terminate the owned child, actual measurements and
  immutable result bytes are rechecked at finalization, and unknown measurements
  fail closed. Measurement and ledger publication now use the same compact JSON
  representation. PLAN-124 advice deliberately remains non-authorizing because
  the live worker and caller-continuation envelopes do not yet share a trusted
  dispatch-time supplier. PLAN-126 therefore closes an execution prerequisite,
  not SC-08/AC-08 or any quality/savings claim.

### Renewed continuation policy (2026-09-19)

The current scheduled instruction requires a completed Copilot review covering
the exact merge candidate; independent reviews supplement, not replace, that
gate for this window. Do not treat the historical fallback above as permission
to skip the current gate. Verify the raw review `commit_id`, not only the
normalized review summary. If a request is stuck, one bounded remove/re-add of
`copilot-pull-request-reviewer[bot]` is permitted; API success is not evidence of
execution. Preserve all branch protections and use expected-head merge commits.

Continue coherent phase branches with separate logical commits, at most one PR
in review and one next unit in preparation. Claim a bounded continuation marker
after checking live agents, processes, worktrees and Git state; release it at
handoff. Report published commit links, actual checks, blockers and next steps
in Bulgarian on each scheduled run. Never imply continuous execution between
runs or manufacture commits for reports. All delegated reviews remain GPT-6
Astra/high or higher. Paid model calls and deployments remain out of scope.

## Architecture direction

Keep Pi as the first adapter and keep the sequential workspace policy. Evolve
existing modules instead of introducing a service cluster, event bus, agent
hierarchy or second framework. The supervisor owns admission and acceptance;
workers produce proposals tied to task/attempt/input identities. Persist state
through one transactional boundary; keep versioned artifacts and compact evidence
references outside model context. Tool/model/environment adapters supply optional
capabilities, not mandatory stages.

Separate deterministic invariants (identity, versions, budgets, permission checks)
from evidence-backed semantic assessments (intent, necessity, correctness). A
schema-valid report or another model's agreement cannot establish the latter.
Compatibility adapters must not preserve a bypass simply to keep a test green.

## Ordered delivery roadmap

| Phase | Work and requirement coverage | Depends on | Acceptance / release boundary |
|---|---|---|---|
| P1 | Repair state read/write behavior, preparation/worker handoff, process termination and actual Pi tool API ownership. SC-13/15/22/25 foundations. | Baseline + this plan | Regression fixtures for each reproduced defect; build and impacted integration checks. Does not certify full SC requirements. |
| P2 | Shared admission/acceptance for every report/command/hook; task and attempt IDs; input/output/validation-policy fingerprints; reject stale/empty evidence, protect criteria, check integration and current requirements. Add revision-checked state writes and explicit interrupted-attempt recovery. SC-01/02/10/13/26. | P1 | AC-01/02/10/13/26 across public routes, including false-success and stale-writer failure injection. Legacy accepted labels never migrate as fresh evidence. |
| P3 | Enforce full model-request admission including actual host/tool content and output reserve; exact section retrieval; effective shrink/split; three per-request routes and eligible local profiles. SC-04/05/07/08/09/25. | P2 contracts | AC-04/05/07/08/09/25; no oversized request dispatched, no silent cloud fallback, real installed host API checks. |
| P4 | Minimal and progressive planning; versioned original user intent, assumptions and constraints; two-way coverage/necessity; valid dependency frontier; affected-only replanning and provenance invalidation. SC-02/03/06/12/27. | P2 contracts, P3 context | AC-02/03/06/12/27 including CSV scope-creep, necessary-prerequisite and correct-minimal-plan controls. |
| P5 | Evidence-led diagnostic attempts, aggregate retry/tactic/review limits, genuine progress detection and risk-triggered independent assessment. Version-aware bounded research. SC-04/06/10/11/15/21. | P3/P4 | AC-04/06/10/11/15/21 with reworded repeats, agent replacement, reviewer-created requirements and evidence-resolved disagreement. |
| P6 | Scoped authority through all routes; uncertain effect reconciliation; compact Git/evidence history; reference-aware retention; optional environment capability/lifecycle. SC-14/16/17/18/19/20/22. | P2 authority, P3 adapters | AC-14/16/17/18/19/20/22 with interruption, denied actions, secret redaction, unrelated changes and unavailable providers. |
| P7 | Supported local-only end-to-end profile; bounded large-run fixtures; honest quality/cost/autonomy evaluation; current SC conformance gate and usable documentation. SC-09/23/24/26 and all integration criteria. | P2–P6 | All applicable AC scenarios with named implementation, host/model, fixtures, resource limits and retained evidence. Unavailable profiles remain blocked/Not assessed. |

Before starting each phase, refine only its next executable units and record
concrete fixture inputs, limits, expected observations and validation commands.
Preserve valid prior results. Any changed requirement or failed assumption reopens
affected acceptance. No whole-product rewrite or speculative provider work.

## P1 executable units and commit boundaries

| Unit | Change / why needed | Focused validation | Status |
|---|---|---|---|
| P1.1 | Read existing state without rewriting; publish complete JSON atomically; initialization must not replace an existing run. | `test/state.test.ts`: stable bytes/mtime, concurrent initializers, invalid JSON, failed publication/reader visibility. | Implemented; focused checks pass |
| P1.2 | Preparation cannot mark a task running; account/admit before dispatch; reload worker-persisted state before usage/handoff instead of overwriting it. | `test/conductor.test.ts`: prepare then execute, refused admission, persisted child updates and changed-run rejection. | Implemented; focused checks pass |
| P1.3 | Escalate timeout/abort based on actual exit; signal termination is a failed run; remove timers/listeners and report cleanup accurately. | `test/subagents.test.ts`: real TERM-ignoring child, timeout, abort, natural completion and spawn failure. | Implemented; focused checks pass |
| P1.4 | Use Pi ExtensionAPI for tool discovery/focus/restore; mocks must place methods on their actual owner; preserve child tool selection. | `test/extension-shape.test.ts`, installed host types, real Pi catalog command, TypeScript build. | Implemented; focused checks pass |

These are prerequisites, not the full recovery or authority implementation. Atomic
replacement alone does not prevent lost updates. P2 must add revision checks and
migrate every mutation path before claiming SC-13. P1.2 addresses the task
conductor only; audit all other child execution paths in P2. P1.3 initially covers
the directly owned process; descendant containment belongs to P6's provider work.

## P2 executable units

P1 merged in PR #2 as `90f347852b758ecb56168dafc6068f2480aef7f7`.
Deliver P2 through bounded PRs; none alone establishes SC-13 or full acceptance.

| Unit | Change | Acceptance boundary | Status |
|---|---|---|---|
| P2.1 | Serialize state publication across processes and compare run identity/revision before replacement. Preserve read-only legacy loading. | Stale writers and concurrent writers cannot lose committed updates; missing/malformed state and held publication locks fail safely. Build and unit/mock integration gate. | Implemented; gate passed, separate ledger flake recorded below |
| P2.2 | Persist attempt identity and input/output/policy fingerprints; reconcile interrupted attempts. | Reject replaced attempts and stale output after restart without replaying uncertain effects. | Merged PR #5 after completed Copilot review; boundary and limitations in PLAN-101 |
| P2.3 | Route reports, commands, hooks and validation through shared version-bound acceptance. | Current independent evidence and integration criteria required; legacy accepted labels are not fresh proof. | In progress: PLAN-102 / PR #6 and PLAN-103 / PR #7 merged; PLAN-104 shares automatic receipt checks; PLAN-105 makes manual positive claims proposal-only. Independent non-software acceptance, aggregate completion and universal authority remain open |

Mutation inventory for P2.1: all production `state.json` publications are in
`src/state.ts`. Callers are `autopilot`, `budgets`, `checkpoints`, `conductor`,
`debug-retry`, `index` commands/hooks, `missing-context`, `operations`, `replanning`,
`reports`, `stage-advancement`, `stage-workflow`, `tasks`, `validation`, and
`watchdogs`. Derived snapshots must carry the revision they read, and successful
saves must propagate the committed revision before the next write. Conflicts are
explicit failures, not automatic retries of actions or merges of stale objects.
The state publication lock is distinct from the longer execution lock so worker
usage hooks can save while their parent waits. No time-based lock stealing.

Other JSON ledgers, multi-file atomicity, process authority and semantic evidence
acceptance remain P2.2/P2.3/P6 work; a state revision does not solve them.
Fixtures: two copies of one revision, two OS processes released from a common
barrier, a deleted state file, legacy/malformed revision metadata, and an existing
publication lock. Focused command: `node --test --import tsx test/state.test.ts`;
final gate: `npm run build` and `npm test`.

### P2.1 validation record and handoff

- Four new regressions failed on P1: stale overwrite, both independent processes
  accepting the same base, recreation of deleted state, and silent run replacement.
  All now pass. Seven added tests also cover logical legacy revision migration,
  invalid revision preservation, and bounded contention without age-based stealing.
- `npm run build` passed. Final `npm test` passed 508/508 unit/component tests
  and 67/67 mock integrations. `git diff --check` passed.
- Pi 0.85.1 with `opencode-free-test/big-pickle` passed the existing synthetic
  task-report/validation-handoff contract 1/1 (about 14 seconds, 45-second limit).
  This checks actual subprocess/report compatibility, not end-to-end quality.
- Fixture changes preserve existing assertions: subsequent actions use the last
  committed snapshot instead of a fresh run or stale pre-action state; the
  replaced-run test now injects an external file replacement explicitly because
  `saveState` correctly refuses it. The Git fixture creates valid state directly
  instead of first writing an incomplete `{}` placeholder.
- A preliminary mock run observed `Unexpected end of JSON input` in
  `loadToolResults` during the parallel tool-schedule test. The ledger code is
  unchanged here. Six bounded isolated checks on merged P1 passed, and the final
  changed-branch gate passed, so baseline reproducibility is not established.
  Do not interpret the final green run as fixing this race risk. Parallel tool
  ledger read/modify/write serialization remains an explicit follow-up.
- P2.2 next: inventory durable attempt/evidence records, include the tool-ledger
  race above, then bind attempt IDs to input/output/policy versions and define
  interruption reconciliation. State conflicts fail explicitly; no automatic
  action replay, stale merge, or multi-file transaction is introduced in P2.1.

## Working and verification process

PLAN-106 continues P2.3 with completion provenance shared by autopilot, stage
conductor/workflow and execution artifact advancement. Build, 615 unit and 67
mock integration tests pass. Historical labels alone cannot complete a run;
postcommit artifact freshness and integrated current-output acceptance remain
open. See PLAN-106 for the exact proof boundary and next unit.

PLAN-107 extends this to accepted Git output integrity: actual commit/path
identity and ancestry, current bytes/modes/deletions and index checks. Build,
629 unit and 67 mock integration tests pass. Skip/non-Git artifact freshness,
unrelated outputs and final semantic/integration acceptance are still open.

PLAN-108 guards the direct Git decision API with full current receipts. PLAN-109
then closes Git index-flag and index-only omissions in candidate identity; its
gate passes build, 649 unit and 67 mock integration tests. None of these units
establishes universal output/semantic acceptance or full P2.3 completion.

PLAN-110 binds explicitly declared filesystem outputs independently of Git at
