# PLAN-179 — Run progress survives worker replacement and state reload

SC-15/AC-15 require replacement workers not to reset the enclosing run's
no-progress clock. The installed parent publishes `running` heartbeats under
`state.runId`; accepted validation publishes evidenced progress in that scope.
The existing ledger appears sufficient. Prefer an acceptance fixture over a
second clock, new policy or production change.

Use a 1,000 ms no-progress threshold and explicit timestamps. Persist an
execution run, publish its initial running heartbeat, finish worker A, reload
state and start worker B under a new task/agent identity. Publish parent liveness
at 1,800 ms; assess at 2,000 ms. The fresh worker is not stale, but the enclosing
run must still pause using its original timestamp and retain recoverable evidence.
As a positive control, a structured consequential-hypothesis observation at
1,500 ms should advance the run clock and avoid a no-progress pause.

This is deterministic process evidence through public ledger/state/watchdog
functions, not a model-quality claim, actual host worker replacement, semantic
proof of a supplied evidence reference, or full AC-15. It does not establish
retention beyond the bounded heartbeat ledger or automatic watchdog scheduling.
Run focused watchdog/integration checks, build, full unit/mock/conformance gate
and independent exact-head review before acceptance. Change production only if
the fixture reproduces a concrete missing boundary.
