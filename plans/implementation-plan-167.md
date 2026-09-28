# PLAN-167 — Reject invalid execution-plan dependency graphs

## Reproduced gap

`validateExecutionPlan` currently checks plan shape, status, duplicate task IDs
and task titles, but it does not validate dependency references or graph cycles.
Consequently a planning report or saved proposal can publish a task that depends
on an absent task, itself, or a dependency cycle. The conductor may later find no
runnable task, but AC-03 requires the invalid plan to be rejected at planning
admission, before requirement, plan or task publication.

Baseline: merged PLAN-166 / PR #33, exact tree
`4acbb62ca5086478439ab0d1f6794d0a6de191d8`.

## Minimal unit

1. Validate dependency references after collecting the complete plan task-ID
   set, so valid forward references remain supported.
2. Reject self-dependencies and multi-task cycles with a compact diagnostic that
   identifies the offending task/path.
3. Apply the same validation through existing plan load/save, planning-report,
   task-application and replan paths by strengthening the shared validator only.
   Do not add another graph representation or persistence layer.
4. Preserve valid one-task plans and acyclic dependency graphs.
5. Keep semantic task necessity, original-intent interpretation, progressive
   milestone expansion and affected-only replanning outside this structural unit.

## Test and commit sequence

- Commit this bounded plan first.
- Add failing regressions for a missing dependency, self-cycle, indirect cycle,
  valid forward-reference DAG and planning-report no-partial-publication behavior.
- Implement the smallest deterministic validation in `src/plans.ts`.
- Run the focused plan tests, TypeScript build and the applicable full gate only
  after the implementation stabilizes; reconcile SC-03/AC-03 as Partial rather
  than claiming full P4 completion.

This unit makes no model-quality, semantic-necessity or scale claim.

## Implemented evidence

The shared execution-plan validator now collects the complete task-ID set before
checking references, preserving valid forward dependencies while rejecting absent
IDs. A deterministic depth-first traversal rejects self-dependencies and longer
cycles. Because planning reports, current/proposed plan load/save, task application
and replan acceptance already use this validator, no second graph representation or
publication path was added.

The focused plan suite passes 25/25 checks, including no-partial-publication for an
unknown dependency. The exact candidate also passes the TypeScript build, 1,210
unit/component tests, 73 mock integration tests, 10 conformance/autopilot checks and
`git diff --check`. This closes only AC-03's structural missing-reference and cycle
examples. SC-03 remains Partial: semantic task necessity, omitted requested scope,
progressive milestone admission and unnecessary design-induced prerequisites remain
outside PLAN-167.
