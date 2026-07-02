# SCALER Manual

This manual documents implemented Scaler behavior.

Design requirements live in `assignement.md` and `specs/`. This manual stays aligned with code that actually exists.

## Current implemented behavior

- Pi extension entrypoint: `src/index.ts`.
- Commands: `/scaler`, `/scaler-lock`, `/scaler-lock-clear`, `/scaler-runs`, `/scaler-tasks`, `/scaler-task-create`, `/scaler-task-update`, `/scaler-prd-status`, `/scaler-prd-link`, `/scaler-task-retry`, `/scaler-step`, `/scaler-validation-add`, `/scaler-validate`, `/scaler-commit`, `/scaler-pause`, `/scaler-resume`, `/scaler-status`.
- State file: `.scaler/state.json`.
- Basic deterministic supervisor transition helpers.
- Event log: `.scaler/logs/events.jsonl`.
- Deterministic safety gate for protected paths, destructive shell commands, protected-path shell access, and current-task allowed paths.
- Experimental task-agent subprocess invocation builder.
- Structured Scaler tool skeletons registered with Pi.
- External memory write/retrieve under `.scaler/memory/`.
- Lightweight context resolver with omitted-context summaries.
- Minimal adaptive `/scaler` entrypoint.
- Budget usage helper skeleton for tools, spawned agents, debug attempts, and checkpoints.
- Checkpoint writing under `.scaler/checkpoints/` for pause/resume and conductor steps.
- Minimal one-step conductor execution with validation handoff artifacts.
- Deterministic validation manifests and command-run records.
- Git status safety and validated-task commit helpers.
- Implemented create/list/step/validate/commit workflow.
- Task-agent run records with timeout/abort diagnostics.
- Mandatory repo-wide sequential execution lock for SCALER operations.
- Runtime PRD ledger under `.scaler/prd/` with requirement coverage summaries and task links.
- Development traceability artifacts for requirement IDs, implementation inventory, matrix coverage, and gap backlog.

## Manual pages

- `manual/state.md`
- `manual/workflow.md`
- `manual/runtime-prd.md`
- `manual/sequential-execution.md`
- `manual/commands.md`
- `manual/context.md`
- `manual/logging.md`
- `manual/memory.md`
- `manual/safety.md`
- `manual/task-agents.md`
- `manual/tools.md`
- `manual/budgets.md`
- `manual/git.md`
- `manual/installation.md`

## Development

Run checks:

```bash
npm test
npm run build
```

Traceability artifacts:

- `requirements-catalog.md` defines stable PRD requirement IDs.
- `implementation-inventory.md` maps implementation task ranges to code/tests/manuals.
- `traceability-matrix.md` maps PRD IDs to coverage status and next actions.
- `gap-backlog.md` tracks uncovered or partial requirements.

Future implementation plans/tasks must update these artifacts when requirement coverage changes.

## `/scaler-status`

Creates/loads `.scaler/state.json` and shows compact supervisor status.
