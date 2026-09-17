# PLAN-104 — P2.3 automatic acceptance uses the shared receipt verifier

Depends on PLAN-103 / PR #7 and PLAN-102. PR #7 must complete review before a
dependent PR can merge. Keep logical commits and no provider spending/deployment.

## Observed defect

A synthetic persisted task in a non-Git temporary project with no validation
commands currently produces `passed`, `acceptance.accepted=true`, a validated
task and an accepted commit-skip record. Explicit commit/skip already reject the
same missing evidence through PLAN-102's verifier. Automatic Git acceptance
therefore bypasses that shared evidence boundary. An all-optional failed command
set is another candidate: rollup success is not positive evidence.

## Bounded next unit

1. Add regression fixtures for empty and all-optional failing validation in
   clean Git and non-Git projects. Assert no validated state, accepted skip or
   commit publication; preserve executed evidence on rejection.
2. Extract the existing receipt verifier so the supervisor can verify its freshly
   generated in-memory record before any automatic Git decision. Keep the public
   current-receipt loader for commit/skip; do not accept caller-submitted receipts
   as new authority or create a second acceptance contract.
3. Require current persisted state and the same task/run/policy/output/result
   checks on both paths. Reject drift, absent evidence and mismatched task records.
   Keep positive real command and declared-skip validation controls.
4. Run focused, build and full unit/mock gates. Adjust only fixtures that relied
   on unpersisted state or false success, retaining evidence and safety assertions.
   Publish tested commits and request final-head Copilot review before merge.

Manual reports/checklists, aggregate completion and postcommit acceptance identity
remain open. This unit does not establish semantic sufficiency, non-Git artifact
versioning, independent reviewer identity, multi-file atomicity or worker isolation.
The in-memory verifier checks supervisor-produced evidence; digests are not signatures.
