# PLAN-192 — Direct validation prerequisite admission

PLAN-190/191 cover conductor dispatch and retention of explicit dependencies.
SC-03/04/10 also require current prerequisite evidence before consequential work
or acceptance. Inspect the public `runTaskValidation` route: objective validation
commands are executable work, not inherently read-only, and direct validation must
not accept a task while a declared prerequisite remains blocked, missing or stale.

Use public task/validation APIs with a validating non-software USE task and an
explicit protected DECISION dependency. A required zero-exit command is sufficient
to witness invocation via its retained command-run record; no provider or real
external effect is needed. Three negative cases (blocked/missing/stale accepted
decision) must refuse before USE commands and before positive acceptance. Current
accepted decision and a task without dependencies are positive controls. A stale
decision changes its declared output only after real successful validation.

First establish RED on current main. If confirmed, reuse the existing dependency
evidence verifier rather than add a separate risk/review gate. Preserve ordinary
manual negative validation and current positive evidence semantics. Check the
validation post-command boundary too: a prerequisite may change while checks run.
No imported-state/semantic necessity/automatic risk/local model/full P5 claim.
No RED merge. Any eventual fix needs applicable full exact-head gate, own review
and independent fresh-context review before expected-head method-merge.

Baseline reproduction: blocked/missing/stale cases each executed one command;
changing the prerequisite during the first of two checks still ran the second.
Four RED / two positive PASS; `/tmp/scaler-plan192-red.log`. The fix reuses
`verifyTaskDependenciesAccepted` before snapshot, before each command and before
acceptance. A final-command mutation control separately checks the last boundary.
This guards declared dependencies, not inferred risk or arbitrary external effects.

The first broad gate passed build and 1284/1285 unit tests, but the existing
planning/policy-lock test timed out waiting for its child start marker under high
parallel load; preserve that failed log, do not call it a repaired defect. Recheck
the same assertion in isolation and run the complete unchanged assertion set with
bounded test concurrency. No timeout/assertion is weakened. Fixture task metadata
is explicit non-software/DoD/path/atomicity rather than relying on API warn mode.
Later prerequisite changes after dependent acceptance and transitive durable
receipt freshness remain separate; this unit checks validation-time boundaries.
