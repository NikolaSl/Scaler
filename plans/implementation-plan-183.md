# PLAN-183 — Stage children share the existing dispatch budget

SC-15 bounds total orchestration effort across agent replacement and stages.
Research/debug already charge the persisted `spawnedAgents` budget before
dispatch, but stage children bypass it. A failed PRD child can be followed by a
planning child after reload without consuming or checking this run-level bound.
This is a concrete remaining P5 boundary, not a new budget subsystem.

Reuse the existing execution lock, snapshot guard and budget functions at stage
execution admission. Preparation stays uncharged. Paused/stale execution refuses
before runner or run publication. Refused launch does not consume the proposed
increment; admitted failed or uncertain launch retains its count. Preserve the
existing inclusive hard-limit semantics (proposed usage >= hard refuses).

Carry updated state through existing stage result/callers so provider usage,
supplemental planning ingestion and advancement do not use the pre-charge
revision. A provider-triggered pause must not advance or publish executable
planning work, even when the child exits successfully.

Regress persisted failed-launch/reload/different-stage refusal, stale/paused
admission, and provider-pause caller propagation. Keep ordinary stage workflow
controls. Run build, full unit/mock/conformance gate and independent exact-head
review. No new helper, ledger, policy defaults or model call. This does not close
replan-agent dispatch, all retry/review limits, direction/necessity assessment,
or full SC-15/P5; do not upgrade aggregate coverage.
