# PLAN-103 — P2.3 generic proposal routes cannot grant acceptance

Dependency: merged PLAN-102 / PR #6, main `10c75e0`.

## Reproduced boundary to investigate

Generic `ingestReport`, `createTask` and `updateTask` can currently request or
create `validated` state without supervisor validation. A generic report can
also complete a run from legacy labels. Metadata updates can rewrite an already
validated task while preserving its accepted status and validated-id membership.
These APIs are proposals/metadata operations, not evidence validators.

## Bounded implementation and commit order

1. Record this plan before code. Add regressions for creation, update from both
   validating/debugging, report task acceptance and run completion (empty and
   legacy-label runs), and mutation of a validated task's contract/policy.
2. Refuse acceptance through these generic routes. Direct callers to dedicated
   validation and run-completion paths. Reject the entire bundled proposal before
   its stage/task/policy mutations; retain existing audit and invalid-transition
   behavior. Accepted task contracts require explicit replanning/replacement,
   not a metadata edit preserving acceptance. No new receipt type or authority
   token is introduced.
3. Verify unchanged state/task-id lists and validation policy on refusal, and
   an audit record. Keep positive ordinary proposals and dedicated receipt-backed
   commit/skip regressions. Run build, unit and mock integration gates.
4. Publish separate plan, implementation/tests and validation-documentation
   commits; request completed Copilot review on the final head before merge.

## Deliberate remaining scope

This is not full P2.3 or SC-01/10/26 compliance. Manual validation reports and
checklists, automatic Git acceptance, direct stage hooks, legacy labels used by
autopilot, postcommit acceptance identity, integration/semantic criteria and
worker protection against direct ledger writes remain open. In particular, a
precommit receipt includes HEAD and cannot naïvely certify postcommit completion.
No runtime-provider spending, deployment, new framework or compatibility bypass.

## Reproduction and implementation record

Nine regressions failed on merged main: create with validated status, updates and
reports from validating/debugging, generic completion from empty/legacy-label
runs, and rewriting validated metadata with/without explicit status. The ordinary
proposal control passed. The fix adds boundary refusals to existing APIs without
new authority tokens or extra persistence. Existing invalid-transition history is
preserved; prohibited acceptance reports are rejected before either transition.

All 57 focused proposal/task/report/receipt tests pass, including positive
receipt-backed commit and skip. No existing test assertions or fixtures changed.
The new creation fixture compares durable manifest bytes rather than timestamps
of dynamically synthesized default manifests. Build and full unit/mock gates
passed: 579/579 unit and 67/67 mock integration. Final-head Copilot review and
merge checks remain required; no live provider test was needed for this boundary.
