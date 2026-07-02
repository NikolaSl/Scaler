# Implementation Plan 009 — Safety and Context Hardening

Goal: harden the currently usable SCALER workflow against unsafe tool use, task scope drift, and silent context loss while keeping runtime behavior deterministic.

Rules:

- Keep tasks atomic and project-compilable after every task.
- Run `npm test` and `npm run build` after each implementation task.
- Commit each validated task separately with its task id.
- Document only behavior implemented in that task.

## IMPL-041 — Block protected-path bash access

Expand the safety gate so shell commands that reference protected paths are blocked, not only write/edit tool calls.

Acceptance:

- Bash commands such as `cat .env`, `cp .env backup`, and `grep secret .ssh/config` are blocked.
- Existing destructive command blocking still passes.
- Manual safety page documents the rule.

## IMPL-042 — Enforce current-task allowed paths for write/edit

Use task `allowedPathPrefixes` to reject write/edit tool calls outside the current task scope when a current task has explicit allowed paths.

Acceptance:

- Safety assessment accepts optional allowed path prefixes.
- Extension `tool_call` hook derives allowed paths from `state.currentTaskId`.
- Write/edit inside allowed paths is allowed; outside paths are blocked.
- Tests cover allowed, blocked, and no-current-task cases.

## IMPL-043 — Add task-agent safety prompt section

Make task-agent prompts explicitly include deterministic safety/scope instructions.

Acceptance:

- Prompt states allowed paths must be respected when specified.
- Prompt states protected paths must not be read or modified.
- Prompt states destructive commands must not be run.
- Tests cover rendered safety section.

## IMPL-044 — Show omitted context summary

Make the context resolver include a compact omitted-context summary so agents know when context was excluded due to budget.

Acceptance:

- Resolved context text includes omitted ids/reasons when optional/useful items are omitted.
- No omitted section is rendered when nothing was omitted.
- Tests cover both paths.

## IMPL-045 — Update safety/context manual pages

Document the implemented safety hardening and omitted-context behavior.

Acceptance:

- `manual/safety.md` reflects current protected-path and allowed-path behavior.
- `manual/context.md` reflects omitted-context summaries.
- Manual index remains accurate.
