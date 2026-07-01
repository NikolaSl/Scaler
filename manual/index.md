# SCALER Manual

This manual documents implemented Scaler behavior.

Design requirements live in `assignement.md` and `specs/`. This manual stays aligned with code that actually exists.

## Current implemented behavior

- Pi extension entrypoint: `src/index.ts`.
- Command: `/scaler-status`.
- State file: `.scaler/state.json`.
- Basic deterministic supervisor transition helpers.
- Event log: `.scaler/logs/events.jsonl`.
- Basic safety gate for protected paths and destructive shell commands.
- Experimental task-agent subprocess invocation builder.
- Structured Scaler tool skeletons registered with Pi.

## Manual pages

- `manual/state.md`
- `manual/logging.md`
- `manual/safety.md`
- `manual/task-agents.md`
- `manual/tools.md`
- `manual/installation.md`

## Development

Run checks:

```bash
npm test
npm run build
```

## `/scaler-status`

Creates/loads `.scaler/state.json` and shows compact supervisor status.
