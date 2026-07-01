# SCALER Attempt Tracking and Debugging Spec

## Purpose

Debugging is where agents often spend the most tokens.

Scaler must make debugging structured, evidence-based, and loop-resistant. The goal is not to stop early, but to avoid repeating failed ideas and force useful investigation or a new approach.

## Principle

Every debug attempt must be tracked as data, not remembered only by the LLM.

The active context should contain only:

- current failure summary
- smallest reproduction
- current hypothesis
- compact attempt stack
- next planned action

Raw logs, tool outputs, and long investigation steps stay in `.scaler/logs/` or `.scaler/memory/`.

## Failure record

When validation fails, create or update a failure record with:

- failure id
- task id
- validation command/check
- expected result
- actual result
- error/log summary
- relevant output references
- failure fingerprint
- first seen timestamp
- last seen timestamp

## Failure fingerprint

A fingerprint is a normalized signature used to detect repeated failures.

It may include:

- failing command/check
- failing test name
- error type
- key stack trace lines
- changed file/path
- normalized error message

Do not include noisy values such as timestamps, random ids, temporary paths, or line numbers when they are unstable.

## Attempt record

Each attempted fix/investigation step should record:

- attempt id
- task id
- failure id
- hypothesis
- action summary
- changed files or commands
- evidence used
- validation run after attempt
- result: `fixed`, `same_failure`, `new_failure`, `partial`, `no_effect`, `worse`, `blocked`
- resulting failure fingerprint, if any
- log references
- timestamp

## Attempt signature

Each attempt should have a normalized signature to detect repetition.

It may include:

- hypothesis category
- target file/component
- type of change
- tool/command used
- validation target

If a new attempt has the same signature and same failure fingerprint as an earlier failed attempt, the supervisor should reject it unless new evidence justifies retrying.

## Debug loop

When a failure appears, the task agent should:

1. Stop unrelated changes.
2. Record the exact failure.
3. Find the smallest reproducible case.
4. Check previous attempts and failure fingerprints.
5. List likely causes ranked by evidence.
6. Select the most likely untried cause.
7. Make the smallest useful change or investigation.
8. Rerun the exact failing validation.
9. Record the attempt result.
10. If fixed, run full task validation.
11. If not fixed, choose a new evidence-backed approach.

## Cyclic fix detection

Scaler should detect cycles where attempts move between known failure fingerprints.

Example:

- Attempt A fixes failure X but causes failure Y.
- Attempt B fixes failure Y but brings back failure X.

When a cycle is detected:

- Do not continue the same cycle.
- Summarize the cycle.
- Investigate the shared root cause.
- Require a different approach that addresses both failures.

## Investigation rules

Investigation is allowed and expected when evidence is insufficient.

Order:

1. Local project files, tests, logs, docs, history.
2. Existing memory and previous task reports.
3. Internet sources only when allowed and local data is insufficient.

Research and source quality should follow `specs/research.md`.

Investigation should produce a concise conclusion with evidence references before another fix attempt.

## Token control during debugging

To reduce token waste:

- Keep only compact attempt stack in active context.
- Store raw logs and large outputs by reference.
- Summarize old failed attempts after they are recorded.
- Do not re-read full logs unless needed.
- Prefer exact failing validation over full validation until the failure is fixed.
- Follow validation gate rules from `specs/validation.md`.
- Run full validation only after the exact failure is resolved.

## Escalation

Escalate to replanning according to `specs/replanning.md` only when the task agent cannot complete investigation, cannot propose a working approach, finds the task/plan wrong, or needs a POC before safe continuation.

Escalation report must include:

- current task state
- completed and validated tasks
- failure record
- attempt stack
- cycle summary, if any
- investigation findings
- why the current plan/task appears wrong or incomplete
- suggested planning changes, if any

## Debug report

The debug report should include:

- failure summary
- reproduction steps
- failure fingerprint
- attempted fixes and results
- detected repeated attempts or cycles
- investigation summary
- root cause, if found
- final changes made
- validation results
- remaining risks or blockers

## Supervisor behavior

The supervisor should:

- persist failure and attempt records
- reject repeated attempts without new evidence
- detect cyclic failure fingerprints
- require exact failing validation after each attempt
- require full validation before accepting task completion
- log all debug decisions according to `specs/logging.md`
