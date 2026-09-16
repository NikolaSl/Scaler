# PLAN-099 — Requirements v2 migration

## Authority and baseline

The user authorized an implementation plan and the start of incremental code
migration, with separate traceable commits. Requirements PR #1 was merged as
`8f4cf197cfb399914d06312193d9921c11b270e0`. The normative catalog remains
`requirements-catalog.md`; its 27 requirements are not replaced by this plan.

Implement through reviewed increments on topic branches. Do not claim v2
compliance or deploy unattended operation while acceptance/authority bypasses
remain. Do not merge a PR automatically. This plan is a durable continuation
record, not a promise of background execution or a scheduled task.

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
| P1.2 | Preparation cannot mark a task running; account/admit before dispatch; reload worker-persisted state before usage/handoff instead of overwriting it. | `test/conductor.test.ts`: prepare then execute, refused admission, persisted child updates and changed-run rejection. | Pending |
| P1.3 | Escalate timeout/abort based on actual exit; signal termination is a failed run; remove timers/listeners and report cleanup accurately. | `test/subagents.test.ts`: real TERM-ignoring child, timeout, abort, natural completion and spawn failure. | Pending |
| P1.4 | Use Pi ExtensionAPI for tool discovery/focus/restore; mocks must place methods on their actual owner. | `test/extension-shape.test.ts`, installed host types, TypeScript build. | Pending |

These are prerequisites, not the full recovery or authority implementation. Atomic
replacement alone does not prevent lost updates. P2 must add revision checks and
migrate every mutation path before claiming SC-13. P1.2 addresses the task
conductor only; audit all other child execution paths in P2. P1.3 initially covers
the directly owned process; descendant containment belongs to P6's provider work.

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
  artifacts around the unchanged 200-day boundary. All four storage-maintenance
  integration tests pass; deletion and preservation assertions remain intact.
- P1.1: regression tests first reproduced a read-side timestamp rewrite and a torn
  JSON read. Atomic same-directory publication and exclusive initialization now
  pass state/checkpoint checks (15/15) and the TypeScript build. Failed publication
  preserves the destination and cleans temporary data. Multi-writer revision
  checks and power-loss recovery are not established by these tests.
- Background execution: no cloud job or automation was created. Resume from this
  plan and repository history, checking current branch/PR state before writing.
