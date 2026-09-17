# PLAN-106 — P2.3 completion requires validation provenance

Dependency: merged PLAN-105 / PR #9, main `19f151f`. Nikola explicitly
requested continuation after the overnight handoff. Existing review/test/merge
policy continues; no deployment or paid model use is authorized.

## Reproduction and bounded contract

Autopilot accepts both execution with all `validated` task labels and a loaded
`completed` stage with no validation records. Execution-artifact advancement
also trusts labels. Reject these routes through a shared read-only proof check
and execution-lock-owned completion publication. A legacy label is not evidence.

For each task require the latest passing, result-bound validation receipt for
the current run/task/contract/policy/attempt/context, plus the matching accepted
Git commit or reasoned skip record. Reuse existing ledgers. Do not let an older
passing record mask a newer failed/blocked run. Check durable state revision and
retain failed completion diagnostics without promoting the run. Loaded completed
state must be verified before reporting completed=true; never rewrite history to
manufacture proof. No additional model invocation or automatic retry.

Historical validation candidates precede their task commits. Therefore this
provenance check must not compare every historical global Git candidate with
today's HEAD. Tests must preserve real successive task commits, a reasoned skip,
and restart after legitimate completion. This increment proves provenance only:
current artifact contents, accepted postcommit output identity and final integrated
deliverable correctness are the next separate unit, not implied by its success.
Do not mark SC-01/10/26 or P2.3 complete. Non-software independent verification and
protection against arbitrary ledger writers remain open.

## Ordered implementation and validation

1. Commit this plan before implementation. Add regressions for execution and
   already-completed legacy labels, artifact advancement, wrong run/task/policy,
   changed command results, missing Git acceptance and newer failed evidence.
2. Share command-evidence integrity checks with the existing receipt verifier;
   keep current-candidate enforcement unchanged on commit/skip paths. Add one
   completion module using existing locks/state publication, and route autopilot
   and artifact completion through it. No new ledger, service or authority flag.
3. Preserve a real two-task validation/commit positive control (distinct files,
   second task depends on first); test skip/non-Git support and resumed completion.
4. Run focused tests, build, full unit/mock integration and conformance. Record
   results and limits, publish separate implementation/documentation commits,
   request Copilot review, resolve findings, merge only reviewed/tested exact head.
5. Continue accepted artifact freshness/integration work with its own bounded
   plan and mutation regressions; do not stop at claiming label guards solve it.

## Reproduction and implementation record

The initial 12-case suite had 10 baseline failures and two positive controls.
Two more baseline failures were reproduced on the loaded-completed paths in
stage-conductor and stage-workflow. These wrappers now also verify provenance
before exposing completed=true. A further regression protects against forged
accepted-id arrays hiding a still-validating task on artifact advancement.

`run-completion.ts` reads existing validation/Git ledgers under the execution
lock, rejects missing/newer-failed/mismatched records, and revision-checks state.
Command integrity is shared with the existing current-candidate receipt verifier;
commit/skip current-candidate checks remain intact. No new receipt or ledger.
Malformed/unavailable evidence fails closed. Completion never dispatches a model.

Two unit stage-chain fixtures and one integration fixture previously completed
zero-task runs. They now seed independently command-checked task evidence and
retain their original chain, ingestion, advancement and completion assertions.
The real two-commit positive control checks both output files at the second step.
Non-Git skip and resumed-completion controls remain supported.

This is intentionally provenance, not final artifact freshness: later file
changes can still escape historical proof checks. PLAN-107 must address that
with real postcommit mutation/rollback regressions and preserve successive
commits, rather than equating historical and current global HEAD.

Gate: TypeScript build, 615/615 unit, 67/67 mock integration and 5/5 conformance
passed. Review pending; no merge is authorized on silence or an older head.
