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

Nikola explicitly extended the current work deadline to 2026-09-17T18:00:00Z
(21:00 Europe/Sofia). This supersedes the prior overnight cutoff. Same completed
review, tests, expected-head merge and separate-commit policy applies.

The 11 new baseline cases failed: nine unsafe acceptance scenarios and two
positive controls with incorrectly derived summary fields. The direct API now
requires a full receipt-bearing record, verifies it with the existing freshness
guard, and derives its summary. Bare runtime summaries fail closed. The original
positive Git-helper fixture now executes validation and retains skip assertions.
The implementation was restored onto PR #11's corrected dependency without
discarding the earlier local commits. Combined validation is recorded below.

Combined gate on corrected PLAN-107 dependency: build, 641/641 unit, 67/67 mock
integration and 5/5 conformance pass. Review is required on the published head.
