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
