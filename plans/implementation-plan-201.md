# PLAN-201 — Reject a replan graph that is not the executable dependency basis

AC-03 forbids downstream execution before a current prerequisite is accepted.
An actual public-route probe found a distinct replan publication defect: v1 has
pending USE; accepted v2 adds MAPPING and USE→MAPPING, but application preserves
the old existing USE contract. The active graph claims the edge while normal
conductor invokes USE with MAPPING still pending. The failed injected runner
proves admission only. This is not semantic necessity inference or task omission.

Use the smallest fail-closed correction: before accepting/publishing a proposed
replan, compare each proposed existing task's dependency set with its runtime
contract. Reject mismatch with a diagnostic directing the caller to the existing
task-update/replacement route. Do not silently rewrite exercised contracts or
add a synchronization mode, schema, lifecycle or latest-plan membership rule.
Normalize order/duplicates and treat omitted/empty dependencies alike. Leave
unmentioned standalone tasks and valid accepted work alone. Recheck accepted
proposal retries too; a prior accepted decision does not excuse a changed basis.

First reproduce rejected-acceptance expectations on the baseline for pending and
ready tasks, added/removed edges and a changed accepted-proposal retry. Preserve
current state/plan/requirements/draft and do not imply a rejected edge governs v1.
Then show actual model-authority updateTask plus the same replan succeeds: register
the prerequisite contract, revise USE, accept v2, schedule/validate MAPPING using
a real artifact command, then admit USE. Keep unchanged/order-only, standalone,
protected/exercised/accepted-policy controls. No blanket extra user confirmation.

Own focused/build/full exact-head unit/mock/conformance/diff gate and fresh
source/rubric-first independent review precede PR acceptance. No assertion,
timeout, byte-cap or exclusion weakening; no semantic CSV coverage/full AC-03,
P4/P5, model-quality/local-inference/scale claim. No paid inference/deployment or
new automation. Handoff/release/stop before 2026-10-26T23:08:20Z; this plan grants
no extension. Existing failed evidence remains retained.
