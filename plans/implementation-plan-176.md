# PLAN-176 — Validate research before publishing raw evidence

Independent of PR #38, on main eb9d533. `recordResearchReport` writes rawEvidence
to the memory index before validating the normalized report. An invalid source
reference can therefore reject the report but leave its memory entries behind.

Add a regression: a report with raw evidence and an unknown conclusion source
must reject without creating memory entries or resolving its research request.
Move the existing raw-evidence loop after normalized report validation; keep
valid raw-evidence storage and request resolution unchanged. No new function,
schema or storage subsystem is needed.

This establishes only schema preflight before publication. It does not provide
a cross-ledger transaction, rollback on I/O failure, semantic source truth or full
SC-21 acceptance. Run focused research/memory tests, build and the applicable
gate; obtain independent exact-head review. Prepare only: do not open a second
PR or merge before PR #38 is resolved.
