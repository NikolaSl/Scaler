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
