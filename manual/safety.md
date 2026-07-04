# Safety

Scaler currently installs a deterministic `tool_call` safety gate.

Implemented blocking rules:

- `write`/`edit` to protected paths such as `.env`, `.git/`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands that reference protected paths such as `.env`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands matching destructive/high-risk patterns such as `rm -rf`, `git reset --hard`, `git clean -f`, force push, `sudo`, `chmod/chown 777`, `docker system prune`, and `kubectl delete`.
- `bash` commands that may expose common secret environment variables such as `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, or `*_PRIVATE_KEY`.
- internet-transfer commands such as `curl`/`wget` to HTTP(S), `ssh`, `scp`, and remote `rsync` unless the caller explicitly supplies an allow-internet policy.
- external mutation/deploy/publish commands such as `npm publish`, package-manager publish variants, `git push`, `docker push`, `kubectl apply`, `helm upgrade/install`, `terraform apply`, `pulumi up`, common cloud deploy/update/delete/sync commands, and release creation unless the caller explicitly supplies an allow-external-mutations policy.

When a current task has explicit `allowedPathPrefixes`, `write`/`edit` calls outside those prefixes are blocked. The current task is read from `.scaler/state.json` using `currentTaskId`.

Task-agent prompts also include safety instructions to respect allowed paths, avoid protected paths, and avoid destructive/external commands.

Blocked actions are written to `.scaler/logs/events.jsonl` as safety events with risk values such as `secret`, `destructive`, or `external`.

Approval workflows, persistent policy files, scanner commands, and sandbox exceptions will be added later.
