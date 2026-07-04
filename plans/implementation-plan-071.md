# Implementation Plan 071 — GAP-010 Safety Approvals, Sandbox Exceptions, and Scanner Commands

## Goal
Close GAP-010 by adding deterministic safety approval records, explicit bounded sandbox exception controls, and optional dependency/image security scanner command support.

## Scope
- Persist safety approval records under `.scaler/safety/approvals.json` and expose `/scaler-safety-approval` to list, create, and revoke approvals.
- Let the tool-call safety hook honor active exact approvals for non-secret risky actions, with use counts, expiry, audit logging, and safe defaults.
- Extend persisted safety policy with an explicit `allow-sandbox` setting that permits only contained sandbox-style destructive commands and denies host mounts, privileged/host-network flags, secrets, protected paths, and external mutations.
- Add security scanner candidate discovery and `/scaler-safety-scan` dry-run/executed records under `.scaler/safety/scans.json` for available dependency/image scanners.
- Add unit, command, mocked integration, and targeted opt-in real Pi coverage.
- Update manuals, inventory, traceability, and backlog.

## Non-goals
- Do not allow approval records to override secret-environment or protected-path safeguards.
- Do not auto-run security scanners without an explicit `execute` command.
- Do not auto-accept deploy/publish/external mutations globally; exact approvals remain scoped and audited.
- Do not implement full scanner result vulnerability parsing beyond deterministic pass/fail/unavailable records.

## Validation
- Targeted safety unit/command/mock tests.
- Targeted real Pi safety approval command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-071: add safety approval and scanner plan`
2. `IMPL-287: add safety approvals and scanner commands`
3. `IMPL-288: cover safety approval and scanner flows`
4. `IMPL-289: document safety approval coverage`
