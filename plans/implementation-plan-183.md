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

## Implementation evidence and limits

Existing lock/snapshot/budget primitives now guard executed stage children;
preparation remains uncharged. Returned state carries admission/provider usage
through CLI advancement, stage conductor and autonomous stage workflow. The child
handoff reloads current same-run state before usage accounting; it refuses a
changed run identity rather than charging or advancing a replacement run. Failed
or thrown launch retains the pre-dispatch count. Provider pause blocks caller
advancement and supplemental PRD/planning ingestion. A stage artifact recorded
from successful output remains a proposal, not authorization to continue paused
work. No new helper/ledger/default policy.

Four regression scenarios reproduced baseline failures: missing launch count,
paused/stale dispatch and stale supplemental planning after provider pause.
Additional controls cover child-persisted state, uncertain launch and conductor
pause propagation. One pre-existing sequential mock fixture needed current state
after the new persisted stage charge; all free-form rejection assertions remain.

Own gate on `730408a` before final handoff correction: build, 1266 unit/component, 74 mock integration,
10 conformance, 52 focused stage/agent/conductor/workflow checks and diff check.
The first full gate exposed the stale mock input; it was corrected by reloading
state, not weakening production admission or dropping assertions. Exact-head
independent review is still required before merge; its final evidence belongs in
the PR conversation. Synthetic runners prove process boundaries only, not model
quality, local inference, resource isolation or savings. Aggregate coverage stays
partial; direction/necessity and separate replan-agent admission remain open.

Own review moved the changed-run check outside failed-child artifact cleanup so
a replacement run's artifacts are not blocked by the old handoff. Its regression
passes with 53 focused checks; the final exact-head full gate is recorded in the PR.
