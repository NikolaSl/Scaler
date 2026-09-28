# PLAN-168 — Preflight structural plan coverage before publication

## Reproduced gap

`applyPlanningReport` currently computes missing and unknown requirement links only
after it has updated the requirement ledger, saved the execution plan and created
or updated tasks. It then returns `accepted: false`, but the rejected proposal has
already become durable executable state. This violates the plan-before-effects and
two-way structural coverage boundary in AC-03.

Baseline: PLAN-167 candidate tree
`2e782fda423fb026c7af8e2453d9bd3bc3778598`.

## Minimal unit

1. Compute prospective requirement IDs from the current catalog plus the report's
   requirement proposals before any publication.
2. Reject a task with no requirement link, a task referencing an unknown
   requirement, or a prospective active requirement with no plan task.
3. Preserve catalog omission semantics: requirements already in the ledger remain
   in scope even when the report does not repeat their content.
4. Keep the existing shared dependency, validation-input and policy preflights.
   Do not add a second plan representation or multi-file transaction layer.
5. Preserve a compact valid one-task plan and valid multi-requirement reports.
6. Keep semantic task necessity, prerequisite justification, original-intent
   interpretation and optional-feature classification outside this structural unit.

## Test and commit sequence

- Commit this bounded plan first.
- Add failing regressions proving no partial requirement, plan, report or task
  publication for unlinked tasks, unknown refs and uncovered persisted/report
  requirements, plus a valid compact control.
- Move only the existing structural diagnostics to a read-only preflight and reuse
  them for the accepted report record.
- Run focused plan/authority/integration checks, build and the applicable full gate
  once the implementation stabilizes; keep SC-03 Partial.

This unit validates graph shape and explicit coverage links. It does not claim that
a link proves necessity or that a model selected the correct requirements/tasks.

## Implemented evidence

Planning admission now loads the current requirement catalog and combines its IDs
with the report's proposed IDs before any write. The existing diagnostics run over
that prospective set and reject uncovered requirements, unknown task references and
tasks without requirement references. The same diagnostic builder supplies the
accepted report record, avoiding a second interpretation of structural coverage.
Omitted catalog entries remain in the prospective set and therefore cannot be
silently dropped by a model report.

The focused plan and policy-authority suites pass 58/58 checks. The exact candidate
also passes the TypeScript build, 1,212 unit/component tests, 73 mock integration
tests, 10 conformance/autopilot checks and `git diff --check`. This establishes only
pre-publication structural coverage. SC-03 remains Partial because explicit links do
not prove necessity, completeness of interpreted user intent, justified
prerequisites or progressive milestone readiness.
