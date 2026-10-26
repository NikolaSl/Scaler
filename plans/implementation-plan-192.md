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
