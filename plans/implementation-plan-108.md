# PLAN-108 — P2.3 direct Git decision requires receipt evidence

Dependency: PLAN-107 / PR #11. While its review runs, close the known remaining
direct `evaluateValidationGitAcceptance` bypass. Its exported API currently
accepts a caller-written summary and publishes an accepted skip without checking
the underlying validation receipt. This remains unsafe even when completion
requires a real record. No new receipt/authority framework or provider work.

1. Reproduce accepted skip publication from a bare passing summary, an empty
   result, a tampered command result, and a stale candidate, including non-Git.
   Require no accepted skip or task-state change on rejection.
2. Require a full ValidationRunRecord and invoke the existing current receipt
   verifier at the direct effect boundary. Derive the Git summary from that
   verified record, never from independent caller counts/statuses. Preserve
   automatic command-validation, clean/non-Git skip and commit-required behavior.
3. Update the previous direct-helper test that certified summary self-approval;
   retain real positive controls through supervisor-produced records. Do not
   weaken any commit/skip or completion tests.
4. Separate implementation/tests and documentation commits; build, full unit/mock
   integration, conformance; final-head review and dependency-ordered merge.

This protects the API against bare/stale evidence, not against a process that can
forge all ledger files and fingerprints. Authenticated child containment,
skip/non-Git output freshness and integrated semantic acceptance remain open.
No paid model or deployment.
