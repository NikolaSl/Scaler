# SCALER Manual

This manual documents implemented Scaler behavior.

Design requirements live in `assignement.md` and `specs/`. This manual stays aligned with code that actually exists.

## Current implemented behavior

- Pi extension entrypoint: `src/index.ts`.
- Commands: `/scaler`, `/scaler-step`, `/scaler-validate`, `/scaler-pause`, `/scaler-resume`, `/scaler-status`.
- State file: `.scaler/state.json`.
- Basic deterministic supervisor transition helpers.
- Event log: `.scaler/logs/events.jsonl`.
- Basic safety gate for protected paths and destructive shell commands.
- Experimental task-agent subprocess invocation builder.
- Structured Scaler tool skeletons registered with Pi.
- External memory write/retrieve under `.scaler/memory/`.
- Lightweight context resolver skeleton.
- Minimal adaptive `/scaler` entrypoint.
- Budget usage helper skeleton for tools, spawned agents, debug attempts, and checkpoints.
- Checkpoint writing under `.scaler/checkpoints/` for pause/resume and conductor steps.
- Minimal one-step conductor execution with validation handoff artifacts.
- Deterministic validation manifests and command-run records.
- Git status safety and validated-task commit helpers.

## Manual pages

- `manual/state.md`
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

## `/scaler-status`

Creates/loads `.scaler/state.json` and shows compact supervisor status.
