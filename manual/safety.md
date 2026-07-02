# Safety

Scaler currently installs a deterministic `tool_call` safety gate.

Implemented blocking rules:

- `write`/`edit` to protected paths such as `.env`, `.git/`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands that reference protected paths such as `.env`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands matching destructive/high-risk patterns such as `rm -rf`, `git reset --hard`, `git clean -f`, `sudo`, `chmod/chown 777`, `docker system prune`, and `kubectl delete`.

When a current task has explicit `allowedPathPrefixes`, `write`/`edit` calls outside those prefixes are blocked. The current task is read from `.scaler/state.json` using `currentTaskId`.

Task-agent prompts also include safety instructions to respect allowed paths, avoid protected paths, and avoid destructive commands.

Blocked actions are written to `.scaler/logs/events.jsonl` as safety events.

Approval workflows and sandbox exceptions will be added later.
