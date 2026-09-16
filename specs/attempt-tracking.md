# Bounded Debugging and Attempt Tracking
Requirements: SC-11. Acceptance: AC-11.

## Failure evidence

Record task/attempt, failing criterion, expected/actual result, output/environment
versions, reproducible evidence and a normalized failure signature.
Normalization must retain distinctions relevant to diagnosis; similar strings
alone do not prove the same root cause.

## Attempt

Track hypothesis, supporting evidence, proposed action, permission/scope, changed
inputs/outputs, check performed and outcome. Keep active context to the current
failure, compact prior approaches and references.
A repair is an attempt within the task unless it changes the task contract.

Reject repetition of the same failed approach on the same inputs without new
evidence. Detect bounded cycles such as fixing X causing Y and restoring X.
A transient failure may justify a capped retry/backoff when classified as such;
it still obeys effect reconciliation and budgets.

## Validation and escalation

Run the smallest relevant failing check after an attempt. Once fixed, run required
affected and integration checks. Do not rerun every expensive suite after every
irrelevant investigation step, or skip required regression evidence.

Escalate the actual deficiency: missing facts, wrong plan, context size or
capability. Replanning is not mandatory for an ordinary failed test.
Stop on exhausted resources, no new evidence/approach or an authority boundary,
with a recoverable report. Track format-repair loops separately from semantic
task failures so they do not trigger duplicate external work.
