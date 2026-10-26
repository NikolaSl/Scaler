# PLAN-198 — Synchronize the three validation/mutation race fixtures

PR60's retained failed gate and diagnosis (#issuecomment-6420163886) show a
finite filesystem poll expiring before the real unit child starts. Mandatory
test-first execution precedes that child. Polling attempts are not a product
latency requirement, and fixture deletion before draining validation can leave
a late child awaiting its release forever.

Change only the three affected test fixtures: observe the matching real command's
parent-side spawn/error under the production validation lock. Race readiness
against validation settlement, and always release/drain started validation and
planning before restoring the observer or deleting the fixture. Preserve the
real child, 50ms planning-pending assertion, failed validation, stale rejection,
no-publication and original DoD assertions. Do not increase polling limits,
change production timeouts, replace real validation with a toy mutex, exclude
tests or claim the original failed gate passed.

Use the existing built-in-module export synchronization pattern. This corrects
the test basis under specs/validation.md, not production semantics. Run focused
policy tests, build, all unit/mock/conformance tests on the exact candidate,
own review and fresh independent review before PR60 acceptance. Existing failed
logs remain evidence; no semantic AC03/model-quality/full-phase upgrade follows.
Current user authority ends 2026-10-26T23:08:20Z; hand off/release before cutoff.

The third fixture (first validation versus model task update) failed in the
retained lower-concurrency gate. Its parent stack was not captured. The retained
validation ledger from `/tmp/scaler-policy-authority-uKJ1pS` records the unique
unit command's first marker write failing ENOENT after fixture deletion, followed
by stale validation publication recreating `.scaler`. Source sequencing proves
the marker wait did not resolve, so no update/pending/stale/DoD assertion had
started: this is an evidence-backed reconstruction of the failed readiness
precondition, not a recovered stack or a product-regression exclusion. Two bounded
instrumented diagnostics (56 and 69 checks) did not reproduce it and are not gates.
Reuse the same real-spawn observer and unconditional release/drain for this third
fixture; remove the now-unused polling helper. Preserve its actual update tool,
50ms pending, failed validation, stale rejection and original DoD assertions.
No production change, timeout increase or acceptance waiver follows. All previous
failed gates remain evidence; require a new exact-head full gate and fresh review.
