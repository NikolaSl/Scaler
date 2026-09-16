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

## Diagnosis and mandatory tactic change

When competing plausible causes imply different repairs, prefer the smallest
check that distinguishes them before another speculative change. Record the
prediction and observed result. A known, evidenced cause does not require invented
alternatives or a fixed hypothesis count. Change one causal factor at a time where
practical; coupled changes need a concise reason and a check that can assess them.
Passing by suppressing a symptom is insufficient when the acceptance criterion
requires the underlying behavior or cause to be corrected.

Configure finite no-progress limits for attempts and elapsed time, within SC-15.
At a limit, the system MUST refuse continuation of the exhausted approach and
either admit an evidence-justified tactic change or stop with a recoverable report.
A change identifies the failed assumption/approach, what new evidence or testable
hypothesis warrants the next action, and the check that distinguishes its outcome.
Permitted responses include targeted retrieval, a diagnostic experiment, local
replanning or an eligible independent reviewer/model when justified.

Rewording a hypothesis, changing a task/agent ID, or alternating X→Y→X does not
constitute a tactic change. A fresh agent inherits compact failed approaches and
the remaining aggregate budget. A revised hypothesis is not progress by itself;
its experiment must produce relevant evidence. Bound tactic changes as well as
retries; never require random novelty after viable approaches are exhausted.

## Validation and escalation

Run the smallest relevant failing check after an attempt. Once fixed, run required
affected and integration checks. Do not rerun every expensive suite after every
irrelevant investigation step, or skip required regression evidence.

Escalate the actual deficiency: missing facts, wrong plan, context size or
capability. Replanning is not mandatory for an ordinary failed test.
Stop on exhausted resources, no new evidence/approach or an authority boundary,
with a recoverable report. Track format-repair loops separately from semantic
task failures so they do not trigger duplicate external work.
