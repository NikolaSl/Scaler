# PLAN-105 — P2.3 manual positive validation is a proposal, not acceptance

Dependency: PLAN-104 / PR #8. Do not merge before that dependency has completed
review. Scope follows SC-01/10: worker assertions do not constitute independent
acceptance evidence. No additional mandatory model, command or environment.

## Observed bypass and bounded remedy

`applyValidationReport` accepts `passed` and `not_applicable` from a caller and
transitions a task to validated. `scaler_validation_report` and manual checklists
reach this API; arbitrary evidence-reference strings can self-approve a checklist.
These interfaces lack a configured independent evidence verifier. Treat positive
claims as recorded proposals, not authority. Do not invent receipt fields or a
boolean trusted flag that a worker can supply.

1. Reproduce direct passed/not-applicable claims from validating/debugging,
   positive checklists with arbitrary evidence refs, and the registered Pi tool.
   Assert no promotion, dependency release, acceptance-state mutation or accepted
   Git record. The registered tool still accounts for the refused tool call.
2. Keep the public report API and checklist persistence/audit behavior. Refuse
   positive claims with a clear diagnostic. Preserve failed/partial/blocked
   observations and existing debugging/replanning behavior.
3. Keep positive state application private to the supervisor command-validation
   path after PLAN-104's shared receipt verification and Git decision. No public
   caller-supplied capability token or bypass parameter.
4. Update tests that previously certified self-approval: preserve checklist
   content/evidence/audit assertions but require no task acceptance. Preserve real
   positive command-validation and commit/skip controls. Dependency-flow fixtures
   must execute checks instead of presenting naked passing claims.
5. Build, focused and full unit/mock gates; separate commits; completed final-head
   Copilot review before merge.

## Compatibility and remaining work

This intentionally closes unsupported manual self-approval. A checklist's
reported `passed` status remains readable evidence of what was claimed, not a
validated task. Non-software acceptance without an independent verifier remains
unavailable; do not prescribe dummy software commands to manufacture approval.
Implementing an appropriate independent verifier is later work, not silently
waiving that requirement. Semantic sufficiency, criteria authority, postcommit
acceptance identity, run completion, raw Git-decision helper authority, general
child isolation and full SC compliance remain open. No deployment/provider spend.

## Reproduction and implementation

All eight new tests failed before the fix: direct positive claims from both
validating/debugging states, both positive statuses through the registered Pi
tool, and custom/source-validation checklists with claimed evidence. All now
refuse task acceptance and retain the audit record. The tool additionally retains
its normal one-call budget accounting; the test asserts that accounting and
unchanged acceptance fields rather than forbidding legitimate bookkeeping.

Positive state application is private within validation.ts and called only after
the supervisor command path verifies its receipt and Git acceptance. Public
manual reports remain compatible as observations, not self-approval. No caller
flag or new receipt format was introduced.

Existing checklist tests retain reported status, evidence and audit assertions,
but replace insecure promotion expectations with refusal/unchanged-task checks.
The dependency integration test now executes a check of the fixture's actual
module export, with its policy declared before dispatch, and still asserts the
dependent task becomes eligible only after supervisor validation. Negative
reports and the real positive command/commit/skip paths remain tested.

Build, 597/597 unit and 67/67 mock integration tests pass. Final-head Copilot
review is required; pending review is not approval. Remaining work includes
evidence-backed non-software validators, postcommit identity/run completion,
raw Git-decision helper authority and authenticated child isolation.
