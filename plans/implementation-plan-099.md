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

### Overnight authorization and review policy

Nikola explicitly authorized autonomous implementation, Copilot review requests,
and merging PRs after review when there are no valid unresolved findings and
applicable tests pass. The unattended work window ends at
`2026-09-17T06:49:57Z` (09:49:57 Europe/Sofia). Stop unattended mutations then
and preserve a handoff unless the user extends or changes the instruction.
This supersedes the earlier no-automatic-merge instruction for this window.

- Request `copilot-pull-request-reviewer[bot]` through the GitHub review-request
  API; the login without `[bot]` is not the supported reviewer identity.
- Wait for a completed review covering the changes. Silence is not approval.
  Evaluate findings against code and requirements; fix valid issues and record
  evidence for findings that do not apply. Re-review changed code when needed.
- Merge only the reviewed, tested head using an expected-head-SHA guard and a
  merge commit to preserve implementation history. Respect branch protection.
- Keep paid model spending and deployment out of scope. Existing free-provider
  synthetic tests are permitted; do not disclose credentials.
- Seven hourly continuation runs were scheduled in this chat, starting at
  02:49:57 Europe/Sofia on September 17. They must inspect current remote state
  before acting and avoid overlapping work. Scheduling is not a guarantee that
  every run will have execution tools or finish a phase; report concrete blockers.
- Next work after PR #3: make the parallel tool-ledger race reproducible, address
  it in a bounded change, then continue P2.2 attempt/evidence binding.

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
| P2.2 | Persist attempt identity and input/output/policy fingerprints; reconcile interrupted attempts. | Reject replaced attempts and stale output after restart without replaying uncertain effects. | Pending |
| P2.3 | Route reports, commands, hooks and validation through shared version-bound acceptance. | Current independent evidence and integration criteria required; legacy accepted labels are not fresh proof. | Pending |

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

1. Add a regression for the concrete defect and observe failure on the prior code.
2. Implement the smallest sufficient fix; preserve unrelated user changes.
3. Run focused checks, then build/integration when the boundary warrants it.
4. Update this record and the affected coverage notes with evidence and limits.
5. Commit one coherent change with its tests and traceability. Never commit secrets,
   generated runtime logs, node_modules or unrelated formatting.
6. Publish a reviewable PR with ordered commits; do not squash away diagnostic
   boundaries during development. A later fix is a new commit, not rewritten history.

The final P1 gate is build plus unit/mock integration tests, with pre-existing
failures distinguished from regressions. A failed gate is not silently waived.
Real-model and full-host end-to-end claims require actual execution in P7.

## Execution record

- Planning: inspected the merged requirements and relevant implementation paths;
  selected the four bounded P1 units above. All later phases remain pending.
- Baseline (`8f4cf19`): TypeScript build passed; 488/488 unit tests and 66/67 mock
  integration tests passed. The sole failure is the known retention fixture using
  December 2025 timestamps against the current clock. Add P1.0: correct only that
  fixture's time reference in a separate commit, retaining old/new deletion checks.
- P1.0: the command-level retention fixture now uses 300-day-old and one-day-old
  artifacts around the unchanged 200-day boundary. All five storage-maintenance
  integration tests pass; deletion and preservation assertions remain intact.
- P1.1: regression tests first reproduced a read-side timestamp rewrite and a torn
  JSON read. Atomic same-directory publication and exclusive initialization now
  pass state/checkpoint checks (15/15) and the TypeScript build. Failed publication
  preserves the destination and cleans temporary data. Multi-writer revision
  checks and power-loss recovery are not established by these tests.
- P1.2: four regressions failed before the fix (preview status, rejected spawn
  accounting, overwritten child updates, replaced-run result). Conductor/autopilot
  tests now pass 27/27. Preview preserves pending/ready status; only admitted
  execution sets running. Handoff reloads durable state and rejects a replaced
  run or ineligible task. This is not general revision-checked concurrency or
  authenticated attempt acceptance; those remain P2 work.
- P1.3: four regressions reproduced false-success exits for timeout/abort,
  ineffective escalation of a TERM-ignoring process, and launching after prior
  cancellation. Subagent/watchdog checks now pass 20/20; the real resistant child
  exits on SIGKILL and its PID is gone before completed cleanup is recorded.
  Normal completion and spawn failure release cancellation listeners. Build passes.
  The evidence covers the directly owned POSIX process, not descendant containment
  or equivalent Windows signal semantics.
- P1.4: the host-shaped regression failed before the API-owner correction. Context
  focus/restore now uses typed ExtensionAPI methods. Correcting this exposed a
  necessary child/parent distinction: spawned children preserve their selected
  tools instead of receiving parent focus. Combined extension/subagent tests pass
  29/29; build passes. The strengthened real Pi catalog-command test passes 1/1
  with the installed host, no model request. Full model-driven host acceptance
  and the three-mode routing migration remain P3/P7 work.
- Background execution: no cloud job or automation was created. Resume from this
  plan and repository history, checking current branch/PR state before writing.

## P1 final gate and next handoff

- 2026-09-16: `npm run build` passed; `npm test` passed 501/501 unit tests
  and 67/67 mocked integration tests. The installed Pi 0.80.3 catalog-command
  integration passed 1/1 without a model request. `git diff --check` passed.
- Spark's exact provider/model ID is recognized by installed Pi. The user
  authorized a test and completed browser-side device authorization, but the
  environment blocked the request to `auth.openai.com` during token retrieval.
  Pi reported no saved Codex authentication. No model request was made; the
  model-backed check remains blocked, not passed. No credentials or device codes
  are stored in this repository.
- Next: refine P2 into mutation-path inventory, minimal versioned acceptance
  contracts, revision checks and interruption fixtures before editing those paths.
  P1 closes specific regressions; it does not establish overall v2 conformance.

## PR #2 Copilot follow-up

### Subsequent model access verification

- Pi 0.85.1 was configured with `opencode-free-test/big-pickle` using OpenCode
  Zen's public free access. A no-tools prompt returned exactly `OK`.
- The existing real contract `task agent report gates validation handoff`
  passed 1/1 with that model (about 24 seconds, 45-second timeout). It exercises
  structured report ingestion, persisted task status `validating`, and durable
  `validation_required` handoff using a synthetic fixture. It does not verify
  actual coding or QA execution. No full real-model suite was run.
- Earlier Codex authentication notes above describe the initial attempt only.
  Subsequent OAuth exchanges saved credentials successfully, but model requests
  still returned HTTP 401. Free-provider success removes that dependency for
  these tests; it does not resolve the separate Codex issue.
- Reproducible non-secret configuration and commands are in `manual/testing.md`
  and `test/integration/real/pi-free-models.example.json`. Pi's existing auth
  entries were not changed for the free-provider setup.

### Review changes

- Review comment 4030518863: valid maintainability concern, not a reproduced
  current failure. Refused dispatch now excludes projected `spawnedAgents` by
  key instead of retaining only array position zero. All other budget updates
  remain eligible regardless of ordering. Existing conductor/budget checks pass
  32/32, covering rejected dispatch and successful context/spawn accounting.
- Review comment 4030518931: valid readability issue. Corrected indentation
  throughout the conductor's existing try body; whitespace-insensitive diff
  confirms no semantic change in this commit.
- Review comment 4030518996: wording clarification only. The previous comment
  correctly allowed for an existing state published by a writer, but did not
  clearly distinguish exclusive initialization from normal replacement. The
  revised comment explicitly describes link for initialization and rename for
  saves, preserving the existing-state protection.
- Follow-up gate: conductor/budget tests 32/32, TypeScript build and
  `git diff --check` pass. Formatting/comment edits do not change runtime logic;
  no new model request or full-conformance claim is introduced.
