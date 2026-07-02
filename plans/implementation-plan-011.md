# Implementation Plan 011 — Mandatory Sequential Execution

Goal: enforce a repo-wide single-operation policy so no SCALER task, tool, validation, or commit workflow runs concurrently in the same project tree.

Rules:

- Keep tasks atomic and project-compilable after every task.
- Run `npm test` and `npm run build` after each implementation task.
- Commit each validated task separately with its task id.
- Document only behavior implemented in that task.

## IMPL-051 — Move implementation plans and add execution lock model

Move development implementation plans into `plans/` and add a deterministic execution lock model under `.scaler/locks/execution-lock.json`.

Acceptance:

- Existing implementation plans live in `plans/`.
- Lock helpers can acquire, load, release, and format lock state.
- Lock creation is atomic when no lock exists.
- Tests cover acquire/refuse/release behavior.

## IMPL-052 — Enforce lock for task-agent spawning and conductor steps

Prevent multiple task agents from running or being prepared concurrently.

Acceptance:

- `/scaler-step` and conductor execution acquire the lock for the selected task.
- `scaler_spawn_task` with `execute: true` refuses when the lock is held.
- Locks are released after success or failure.
- Tests cover refusal and release.

## IMPL-053 — Enforce lock for validation and commits

Prevent validation and commit operations from overlapping with any other SCALER operation.

Acceptance:

- `/scaler-validate` runs under the execution lock.
- `/scaler-commit` runs under the execution lock.
- Locks are released after success or failure.
- Tests or command helpers cover lock refusal paths.

## IMPL-054 — Add lock status and clear commands

Add user-facing lock inspection and explicit manual clearing.

Acceptance:

- `/scaler-lock` shows current lock or reports none.
- `/scaler-lock-clear <reason>` clears the current lock and logs the reason.
- Manual clear is explicit; no automatic stale lock clearing is implemented.
- Tests cover formatting and clear helper.

## IMPL-055 — Document mandatory sequential execution

Document the strict no-parallelism policy.

Acceptance:

- Manual states all SCALER agents/validation/commit operations are sequential per repo.
- Manual describes lock file location and clear command.
- Manual index remains accurate.
