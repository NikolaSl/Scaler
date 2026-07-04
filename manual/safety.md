# Safety

Scaler currently installs a deterministic `tool_call` safety gate.

Implemented blocking rules:

- `write`/`edit` to protected paths such as `.env`, `.git/`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands that reference protected paths such as `.env`, `.ssh/`, `.aws/`, `*.pem`, `*.key`, `*.p12`.
- `bash` commands matching destructive/high-risk patterns such as `rm -rf`, `git reset --hard`, `git clean -f`, force push, `sudo`, `chmod/chown 777`, `docker system prune`, and `kubectl delete`.
- `bash` commands that may expose common secret environment variables such as `*_TOKEN`, `*_SECRET`, `*_PASSWORD`, `*_API_KEY`, or `*_PRIVATE_KEY`.
- internet-transfer commands such as `curl`/`wget` to HTTP(S), `ssh`, `scp`, and remote `rsync` unless the caller explicitly supplies an allow-internet policy, persisted SCALER safety policy enables it, or a scoped exact approval applies.
- external mutation/deploy/publish commands such as `npm publish`, package-manager publish variants, `git push`, `docker push`, `kubectl apply`, `helm upgrade/install`, `terraform apply`, `pulumi up`, common cloud deploy/update/delete/sync commands, and release creation unless the caller explicitly supplies an allow-external-mutations policy, persisted SCALER safety policy enables it, or a scoped exact approval applies.

When a current task has explicit `allowedPathPrefixes`, `write`/`edit` calls outside those prefixes are blocked. The current task is read from `.scaler/state.json` using `currentTaskId`.

Task-agent prompts also include safety instructions to respect allowed paths, avoid protected paths, and avoid destructive/external commands.

Persisted safety policy lives at `.scaler/safety/policy.json` and can be inspected or updated with:

```text
/scaler-safety-policy
/scaler-safety-policy allow-internet=on allow-external=off allow-sandbox=off
```

The persisted policy can allow internet-transfer and external-mutation command classes. `allow-sandbox=on` enables a narrow sandbox exception for destructive command patterns only when the command is visibly wrapped in an approved sandbox envelope such as `docker run --rm`, `docker compose run`, `podman run`, or `devcontainer exec`, and it does not include privileged mode, host networking, broad host mounts, protected paths, secret exposure, internet transfer, or external mutation patterns. The persisted policy does not override protected-path, secret-environment, or task allowed-path blocks.

Scoped safety approvals live at `.scaler/safety/approvals.json` and can be created, listed, or revoked with:

```text
/scaler-safety-approval
/scaler-safety-approval approve | bash | exact_command | npm publish --dry-run | external | Release dry run | max-uses=1 ttl-minutes=60
/scaler-safety-approval revoke | <approval-id> | no longer needed
```

Approvals are audited, can expire, and are consumed by use count. They currently authorize non-secret risky decisions such as exact external/destructive commands or exact write targets; they do **not** override secret-environment or protected-path blocks.

Optional security scanner records live at `.scaler/safety/scans.json`. `/scaler-safety-scan` discovers candidate scanners from dependency/image manifests (`npm audit`, `pnpm audit`, `yarn npm audit`, `pip-audit`, `cargo audit`, `trivy fs`, `grype`) and records dry-run, unavailable-tool, passed, or failed results. Scanners are not run unless `execute` is passed:

```text
/scaler-safety-scan
/scaler-safety-scan execute kinds=npm_audit,trivy_fs
```

Blocked and approval-allowed actions are written to `.scaler/logs/events.jsonl` as safety events with risk values such as `secret`, `destructive`, or `external` and approval ids when applicable.

Validation environment lifecycle evidence exists for declared local-CI/sandbox validation gates. Sandbox safety exceptions are still explicit and bounded; they do not grant host-destructive, secret, deployment, publishing, or external-mutation access.
