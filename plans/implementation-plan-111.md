# PLAN-111 — Require an output basis for skipped-task completion

## Scope and rationale

PLAN-110 provides optional declared output identity. Without a declaration, a
non-Git or commit-skipped task can still lead to completed run status with no
filesystem freshness basis. Continue P2.3 / SC-01/10/26 by refusing completion
when such a task has neither verified committed outputs nor explicit manifest
`outputPaths`. An explicit empty set is suitable only for tasks whose outputs
are not filesystem artifacts; the command/attempt/policy evidence still applies.

Use the existing completion boundary so execution artifacts, autopilot, stage
workflow/conductor and loaded completed states cannot bypass this rule. Keep
the historical state on rejection and explain how to declare outputs/revalidate.
Do not infer an empty list or migrate old proofs. Real committed-output tasks
retain their existing proof path. This does not establish that a declaration is
complete or authorized, or final semantic/integration correctness.

## Ordered work

1. Commit this plan. Reproduce unknown-output completion in Git skip and non-Git
   cases; retain explicit file/no-filesystem-output controls.
2. Refuse missing declarations at completion. Update only affected synthetic
   fixtures with their real files or an explicit no-filesystem-output basis;
   retain original state/flow assertions.
3. Run focused checks, build, full unit/mock integration and conformance. Record
   behavior/limits and logical commits; complete Copilot review before merge.

Per-task skip admission and planning declaration transport remain next bounded
units; this change specifically closes publication of a completed run without
an output basis. No paid provider, deployment or new verifier framework.

Fixture inspection identified one necessary preservation change: task planning
or command updates rewrote the validation manifest and discarded previously
configured outputPaths. Preserve that existing basis when replacing commands;
the changed commands still invalidate policy identity. The full orchestration
fixture predeclares [] before planning because its synthetic task emits no files,
while file-producing fixtures declare one.txt, result.txt, fixed.txt or index.js.
No worker is allowed to retrofit its own basis during an admitted attempt.

## Validation and next action

Four regressions reproduced unknown-output false completion in Git/non-Git
execution and loaded completed states; the explicit [] control passed before
and after. Focused combined tests: 53/53. Full gate: build, 676/676 unit,
67/67 mock integration and 7/7 conformance/autopilot. Existing completion/flow
assertions remain; five unit and one integration fixture now declare their
actual output basis. No legacy state was rewritten as fresh proof.

Next: enforce a declared basis at per-task commit-skip admission and transport
declarations through planning/task inputs, without giving workers authority to
weaken them. Declaration adequacy and authorized policy changes plus final
semantic/integration acceptance remain open. P2.3 is incomplete.

Restored onto PLAN-110's reviewed schema-version correction before publication.
Combined gate: build, 678 unit, 67 mock integration and 7 conformance/autopilot
checks pass, including both new version controls. Prior local commits retained.

## Copilot preservation follow-up

The suppressed finding in review 5233293400 is valid. Command replacement
preserved outputPaths but dropped other existing manifest fields. A regression
failed before repair. Persistence now spreads the existing manifest and changes
only the command set, supplied DoD and update timestamp, retaining criteria,
waivers, creation identity and a preconfigured DoD when task metadata omits it.
This does not authorize arbitrary acceptance-policy changes.
