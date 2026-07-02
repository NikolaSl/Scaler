# Implementation Plan 010 — Execution Reliability

Goal: improve task-agent execution reliability by preserving run details, exposing failure diagnostics, and adding deterministic retry/resume helpers.

Rules:

- Keep tasks atomic and project-compilable after every task.
- Run `npm test` and `npm run build` after each implementation task.
- Commit each validated task separately with its task id.
- Document only behavior implemented in that task.

## IMPL-046 — Persist task-agent run records

Persist task-agent run metadata under `.scaler/reports/task-agent-runs.json` for every executed conductor step.

Acceptance:

- Records include task id, exit code, stderr summary, stdout event count, status, and timestamp.
- Conductor writes run records when `execute: true`.
- Tests cover record persistence for successful and failed task-agent runs.

## IMPL-047 — Capture timeout/abort diagnostics

Make task-agent run results explicitly report timeout/abort diagnostics.

Acceptance:

- `TaskAgentRunResult` includes `timedOut` and `aborted` booleans.
- Timeout path sets `timedOut: true` and preserves timeout stderr.
- Abort signal path sets `aborted: true`.
- Tests cover result shape through injected and real runner behavior where practical.

## IMPL-048 — Add deterministic task retry helper and command

Add a retry helper/command to move failed/debugging/blocked/needs_replan tasks back to a runnable state when valid.

Acceptance:

- `/scaler-task-retry <taskId> | <reason>` retries the requested task or current task.
- Failed terminal tasks are not mutated by invalid transition rules; command reports rejection.
- Debugging/blocked/needs_replan tasks can return to runnable states where supervisor rules allow.
- Tests cover accepted and rejected retry cases.

## IMPL-049 — Add task-agent run listing command

Expose compact task-agent run diagnostics to users.

Acceptance:

- `/scaler-runs [taskId]` lists recent task-agent run records.
- Optional task id filters records.
- Output includes status, exit code, timeout/abort flags, and stderr summary when present.
- Tests cover formatting/filtering.

## IMPL-050 — Update execution reliability manual docs

Document implemented run records, timeout/abort fields, retry command, and run listing command.

Acceptance:

- Manual pages reflect implemented behavior.
- Manual index remains accurate.
