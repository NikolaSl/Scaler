# Logging

Scaler writes append-only structured events to:

```text
.scaler/logs/events.jsonl
```

Each event is one JSON object per line.

Current implementation logs `/scaler-status` state reads and supports basic event writing helpers.

Large tool, agent, and validation logs will be added later under `.scaler/logs/` subfolders.
