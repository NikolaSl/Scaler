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
