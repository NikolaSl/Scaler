# PLAN-169 — Preflight concrete task contracts before plan publication

## Reproduced gap

Planning reports enforce task-definition quality only while applying tasks, after
requirements and the execution plan are already durable. A coarse task missing its
Definition of Done, path scope, atomicity basis or validation contract therefore
leaves a published plan and requirement coverage even though task creation returns
rejected. AC-02/03 require the concrete next-work contract to be admitted before it
becomes executable or publishes planning effects.

Baseline: PLAN-168 candidate tree
`38e7f0a9cc30ca203276796c5b513505d431fc40`.

## Minimal unit

1. Reuse the existing read-only task-quality assessor in `enforce` mode before the
   first planning-report write.
2. Assess the exact prospective task definition: a new pending task or the current
   task with the report's supplied fields overlaid using existing update semantics.
3. Include proposed validation commands/refs and existing manifests exactly as the
   later create/update path does; honor existing explicit quality waivers.
4. Reject all blocked task IDs and warning codes in one deterministic diagnostic.
5. Preserve compact valid tasks and preconfigured-policy inheritance.
6. Do not add a second task schema, reviewer role, semantic necessity classifier or
   multi-file transaction layer.

## Test and commit sequence

- Commit this bounded plan first.
- Add a failing no-partial-publication regression for a structurally covered but
  incomplete task, plus controls for a complete compact task and explicit waiver.
- Add the smallest read-only preflight before requirement/plan/task publication.
- Run focused plan/task-quality/policy checks, build and the applicable full gate
  after stabilization; keep SC-02 and SC-03 Partial.

This verifies the FSM contract-admission step. It does not prove that a contract's
prose is semantically correct or that a model chose the necessary task.

## Implemented evidence

Planning-report admission now builds the exact prospective task definition before
any write, overlaying supplied fields on an existing task or creating a pending
candidate. Replan acceptance applies the same contract and structural-coverage
preflights before its snapshot or active-plan writes, while skipping existing tasks
that the replan application path does not update. Both routes invoke the existing
task-quality assessor in enforce mode with the same proposed commands/refs and
stored validation manifest used by later task application. All blocked tasks and
warning codes are returned in one deterministic refusal; explicit waivers retain
their established behavior.

The focused plan, task-quality and policy-authority suites pass 65/65 checks. The
exact candidate also passes the TypeScript build, 1,216 unit/component tests, 73
mock integration tests, 10 conformance/autopilot checks and `git diff --check`.
This makes the concrete contract a pre-publication FSM gate. SC-02 and SC-03 remain
Partial because field presence and policy shape do not prove semantic correctness,
task necessity, original-intent fidelity or progressive milestone selection.

The independent exact-head review found that `acceptReplanProposal` initially
bypassed both preflights. Two test-first regressions reproduced active-plan
publication for an incomplete new task and an unknown requirement reference; the
shared preflights now reject both before any replan publication.
