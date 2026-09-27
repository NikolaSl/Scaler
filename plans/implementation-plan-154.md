# PLAN-154 — P3 terminal child outcome parity for task and debug retry

## Status

Preparation after reviewed PR #24 merged; the exact-head Terra reviewer found
this baseline gap outside PR #24's stage-admission scope.

## Observed gap

Task conductor and debug retry still equate `exitCode === 0` with child success.
A Pi JSON-mode terminal `message_end` with `stopReason: error` or `aborted` can
exit 0 and include a completed task report. These paths ingest the report,
mark the attempt and run passed, and send the task to validation despite the
terminal failure. The shared `taskAgentRunSucceeded` predicate already covers
the correct terminal semantics in other child paths.

## Bounded unit

Use the shared terminal outcome predicate consistently for task/report
ingestion, run records, attempt completion, validation handoff and debug retry
continuation. A zero-exit terminal failure must fail before report ingestion or
exact validation while preserving usage accounting and an explicit failed
handoff. Add test-first conductor/debug-retry regressions for both terminal
reasons. Keep provider admission and stage artifact quarantine unchanged.
