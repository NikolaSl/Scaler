# PLAN-104 — P2.3 automatic acceptance uses the shared receipt verifier

Depends on PLAN-103 / PR #7 and PLAN-102. PR #7 merged as `1398bd3` after
completed Copilot review recommending approval. Keep logical commits and no
provider spending/deployment.

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

## Implementation and validation

Five new regressions failed before implementation: empty/optional-failure runs
in clean Git and non-Git fixtures, plus stale state failing only after publishing
a skip. Four positive passed-command/declared-skip controls passed before and
after. The tenth new test verifies record/task identity even when its result
digest is recomputed consistently.

`verifyCurrentValidationReceipt` now loads the latest record and delegates to
`verifyValidationRunReceipt`; automatic task validation uses that same verifier
on its supervisor-generated record before publishing any Git acceptance. Passing
runs reuse the verifier's final snapshot rather than adding a third candidate
hash. Failed/blocked command outcomes retain their existing freshness checks.
Rejections persist blocked runs and retain executed command evidence, without
promoting the task or publishing an accepted skip/commit.

The prior optional-failure fixture is strengthened: acceptance now blocks before
commit, still refuses commit, retains failure evidence and asserts no accepted
Git records and no validated state. No positive test or assertion was removed.
Build, 46/46 focused, 589/589 unit and 67/67 mock integration tests pass. Local
rebase of unpublished commits onto merged PR #7 preserved the exact tested tree.
Final-head Copilot review remains required before merge.

The raw exported Git-decision helper, manual report/checklist acceptance, run
completion and authenticated worker authority remain explicit follow-up work;
this unit covers `runTaskValidation` and its existing execution-lock wrapper.
