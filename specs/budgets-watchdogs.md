# Budgets and Progress Watchdogs
Requirements: SC-15. Acceptance: AC-15.

## Resources and accounting

Set run limits with inherited task/attempt limits where needed. Track input/output
tokens, monetary usage when known, wall-clock time, model calls, tools, agents,
retries and storage. Optional profiles may add device memory/concurrency limits.
Include planning, routing, review, report repair, debugging and child usage;
avoid double-counting the same provider event.

Distinguish measured, estimated, reserved and unknown amounts. Missing provider
cost data MUST NOT be recorded as zero cost. Local runs report tokens and time
even when monetary pricing is unavailable.

## Admission and stopping

Before dispatch, check known usage plus reservations against the applicable limits.
Use output caps/timeouts and bounded tool results where supported. Reconcile
reservations after completion. Unknown/unbounded costs need a configured
conservative cap or refusal of a strict-budget operation.

Soft limits may reduce optional work or choose a cheaper eligible route without
weakening required validation. Hard limits stop new chargeable/effectful work and
pause/terminate safely. Reserve a bounded allowance for cancellation, reconciliation,
checkpointing and user reporting. Document unavoidable in-flight overshoot and
unavailable provider cancellation; never promise a stronger cap than enforced.

## Progress

Heartbeat/liveness is separate from meaningful progress: accepted artifacts,
fixed reproducible failures, ruled-out consequential hypotheses, retrieved missing
facts, or completed checks that resolve an open acceptance question. Progress MUST
identify relevant evidence and what changed toward the task's acceptance.
Repeated green checks, rewritten plans, new agents, searches or hypotheses alone
MUST NOT reset the progress clock. A different error is diagnostic evidence only
when it advances diagnosis; producing new errors is not automatically progress.
Detect bounded time without progress, repeated attempts and repeated replanning.
Configure attempt/time limits and aggregate limits for tactic switches and reviews.
At no-progress limits, enforce the change-or-stop rule in SC-11; new tasks, sessions
and reviewers MUST NOT reset the enclosing run's usage or failure history.
Long-running legitimate operations use a declared bounded allowance and relevant
observable milestones where available; do not force arbitrary edits to look active.
Terminate owned processes with verified exit and escalation where supported.
Do not report cleanup complete because a termination signal was sent.

Checkpoint and recovery follow SC-13/SC-14. Reuse existing budget authorization;
request expansion only when actually required.
