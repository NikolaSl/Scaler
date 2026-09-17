# PLAN-116 — Require current PRD coverage before run completion

## Authority and baseline

This bounded P2.3 unit follows merged PLAN-115 / PR #19. The applicable
requirements remain `requirements-catalog.md`, especially AC-26 and SC-10. The
existing run-completion boundary already requires current accepted evidence for
every task, but it does not inspect the runtime PRD requirements or coverage.

## Reproduced defect

A run whose tasks all have current accepted evidence can complete after a new
runtime requirement is added without any linked task. An explicit `validated`
coverage entry that names only a nonexistent task also appears validated to the
coverage summary and does not prevent completion. Both cases let the supervisor
accept a run that does not cover the current requirements.

## Bounded change

Before accepting run completion, load the current runtime requirements and
coverage under the existing execution lock. When requirements exist, require
every requirement to:

- link to at least one task in the current state;
- contain no explicit or derived task link absent from the current state; and
- have computed status `validated`.

Keep the existing behavior when no runtime requirements are recorded. Reuse the
existing PRD store and computed coverage model; do not add a second completion
manifest, infer semantic coverage, or alter planning and task admission.

## Acceptance and commit boundaries

1. Add regressions that fail on the merged baseline for an unlinked current
   requirement and a stale explicit task link, plus a linked validated control.
2. Add the minimal completion guard and run the focused tests.
3. Record the result and limitations, then run TypeScript build, all unit tests,
   mock integration and conformance/autopilot checks.
4. Preserve plan, regression, implementation and documentation as separate
   logical commits. Merge only after a completed exact-head Copilot review with
   no valid unresolved findings.

This unit proves structural current-requirement coverage at final completion. It
does not prove that task-to-requirement links are semantically correct, that the
declared task set is minimal, or that cross-task integration is adequate.

## Result

Two baseline regressions confirmed that final completion accepted both an
unlinked current requirement and a coverage entry naming only a nonexistent
task. The completion verifier now loads current runtime requirements and coverage
under its existing execution lock and rejects missing links, stale task ids and
any computed status other than `validated`. Runs without runtime requirements
retain their prior behavior; a current task linked through `prdRefs` remains a
positive control.

The existing staged integration fixture now states its already-assumed
`REQ-STAGE` task link. Final gate: TypeScript build, 713 unit tests, 67 mock
integration tests and 7 conformance/autopilot checks pass. Semantic link
correctness, minimality, authority and cross-task integration adequacy remain
outside this structural guard, so P2.3 and SC-10/26 are not declared complete.
