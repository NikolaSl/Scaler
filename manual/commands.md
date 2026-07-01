# Commands

## `/scaler <request>`

Starts a minimal adaptive Scaler run.

Current behavior:

- creates/loads `.scaler/state.json`
- selects a complexity level from the request text
- moves supervisor state to the initial stage for that level
- logs the request to `.scaler/logs/events.jsonl`
- shows compact status

This is an early entrypoint. It does not yet execute the full Stage I-IV workflow.

## `/scaler-status`

Creates/loads `.scaler/state.json`, logs the status request, and shows:

- current stage and complexity level
- validated task count
- task status counts
- rejected transition count
- memory count
- event log path
