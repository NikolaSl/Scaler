# PLAN-174 — Repeated green validation is not progress

SC-15 / AC-15 explicitly prohibit repeated already-passing checks from resetting
the progress clock. Reassess PLAN-172's automatic validation publisher before
adding duplicate-progress suppression.

## Minimal unit

Exercise an accepted validation followed by a passing validation after reloading
persisted state. Keep both validation records, but require the progress clock and
heartbeat ledger to remain unchanged for the repeated check.

The fixture disproved the suspected gap: the existing task-status acceptance
guard refuses a positive validation from `validated`, so the publisher does not
run a second time. No production code change is needed for this control. This
does not establish all forms of semantic repetition across reopened tasks.
Focused validation and independent exact-head review cover this test-only unit;
the full applicable gate remains required before phase PR acceptance.

## Boundaries

This is deterministic duplicate-evidence suppression, not a semantic progress
classifier. Tactic/review limits, other publishers and long-running allowances
remain separate. SC-15 stays Partial.
