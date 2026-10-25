# PLAN-184 — Replanner dispatch shares the existing run budget

SC-15 includes planning/review effort and stops chargeable work at hard limits.
The dedicated replan agent still bypasses the shared spawnedAgents admission
used by research, debug and stage children. Reuse the existing lock, snapshot,
paused-state and budget primitives; no new helper, ledger or policy defaults.
Preparation stays uncharged. Refused launch preserves usage; admitted failed or
uncertain launch stays charged. Preserve existing inclusive hard-limit semantics.

Reload same-run child state before provider accounting, return current state and
carry it through stage-workflow acceptance. Reject changed-run handoff before
proposal ingestion/accounting. Provider hard pause prevents proposal ingestion
and auto-acceptance even with a successful child exit. Existing debug conductor
already reloads state; CLI does not subsequently mutate it.

Regress failed-launch/reload refusal, stale/paused dispatch, child-persisted
state and provider-pause workflow acceptance. Keep valid proposal/ordinary
workflow controls. Build, full unit/mock/conformance, focused checks and fresh
independent exact-head review before merge. No scope expansion to all review or
retry limits, direction/necessity protocol, reservations or full SC-15/P5. Mock
runners prove process boundaries, not model quality or configured local inference.
