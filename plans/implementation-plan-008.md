# Implementation Plan 008 — Workflow Operability and Sequencing

Goal: make the implemented SCALER workflow easier to inspect, sequence safely, and operate end-to-end without relying on direct tool calls.

Rules:

- Keep tasks atomic and project-compilable after every task.
- Run `npm test` and `npm run build` after each implementation task.
- Commit each validated task separately with its task id.
- Update manual pages only for behavior implemented in that task.

## IMPL-036 — Workflow status aggregation

Add a deterministic workflow summary helper used by `/scaler-status` that reports:

- next recommended command/action
- current task lifecycle position
- task readiness/validation/commit hints
- blocked/debugging warnings when present

Acceptance:

- Status helper is unit tested.
- `/scaler-status` output includes the workflow summary.
- Manual status documentation describes only implemented fields.

## IMPL-037 — Task dependency metadata

Add task dependency metadata and make the conductor respect it.

Acceptance:

- Tasks can store `dependsOn: string[]`.
- Task creation command/tool accepts dependency ids.
- `selectNextTask` does not select tasks whose dependencies are not validated.
- Task list/prompt show dependencies.

## IMPL-038 — Task update command/tool

Add deterministic task metadata updates for existing tasks.

Acceptance:

- Add helper, structured tool, and command for updating title, allowed paths, dependencies, and valid status transitions.
- Invalid status transitions are rejected through supervisor rules.
- Tests cover metadata updates and rejected transitions.
- Manual documents command/tool usage.

## IMPL-039 — Validation manifest command

Add a user-facing command for writing simple task validation manifests.

Acceptance:

- `/scaler-validation-add <taskId> | <id> | <command> | <description> | <required>` appends/replaces one command in a task manifest.
- Reuses existing validation manifest storage.
- Tests cover parsing and manifest update behavior.
- Manual documents the command.

## IMPL-040 — End-to-end workflow manual

Document the implemented happy-path workflow and important safety refusals.

Acceptance:

- Add compact manual page covering create → list/status → step → validate → commit.
- Link it from the manual index.
- No unimplemented behavior is documented as available.
