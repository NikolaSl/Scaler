# Safety

Scaler currently installs a basic `tool_call` safety gate.

Implemented blocking rules:

- `write`/`edit` to protected paths such as `.env`, `.git/`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands matching destructive/high-risk patterns such as `rm -rf`, `git reset --hard`, `git clean -f`, `sudo`, `chmod/chown 777`, `docker system prune`, and `kubectl delete`.

Blocked actions are written to `.scaler/logs/events.jsonl` as safety events.

Approval workflows and sandbox exceptions will be added later.
