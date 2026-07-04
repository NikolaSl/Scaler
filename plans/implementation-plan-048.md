# Implementation Plan 048 — GAP-010 External/Internet Safety Gates

## Goal
Broaden deterministic safety gates beyond protected paths/destructive commands by blocking explicit internet transfer, deploy/publish, remote mutation, force-push/history rewrite, and secret-environment exposure patterns unless an explicit policy allowance is supplied.

## Scope
- Add `external` risk classification and policy knobs for internet transfer and external mutations.
- Block bash commands that transmit to unknown internet endpoints (`curl`/`wget` HTTP(S), SSH/SCP/rsync remote targets) unless `allowInternet` is true.
- Block deploy/publish/remote mutation commands (`npm publish`, package publish variants, `git push`, `docker push`, `kubectl apply`, cloud/infra deploy/apply commands, release creation) unless `allowExternalMutations` is true.
- Block common secret environment variable exposure (`$*_TOKEN`, `$*_SECRET`, `$*_PASSWORD`, `$*_API_KEY`, etc.) as `secret` risk.
- Preserve existing protected-path/destructive/allowed-path behavior.
- Add unit tests for blocked and explicitly allowed policies.
- Add mocked integration coverage through the real extension `tool_call` hook and persisted safety audit logs.
- Add opt-in real Pi/model safety-hook coverage for a cardinal deploy/publish command blocked by SCALER.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- Do not add an approval UI or persistent approval policy file yet.
- Do not implement sandbox execution or scanner integrations yet.
- Do not allow internet research by default; research-specific internet tool policy remains GAP-019.

## Validation
- `./scripts/run-real-integration.sh`
- `npm test`
- `npm run build`

## Commits
1. `PLAN-048: add external safety gate plan`
2. `IMPL-188: add external safety policy gates`
3. `IMPL-189: add mocked external safety hook coverage`
4. `IMPL-190: add real external safety hook coverage`
5. `IMPL-191: document external safety gate coverage`
