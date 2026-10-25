# PLAN-180 — Bound diagnostic children using the existing run budget

SC-15 includes diagnostic child usage and requires hard stops before new work.
After PLAN-178 research admission, `runDebugAgentStep` still bypasses the shared
`spawnedAgents` counter. Use the existing budget update/publication functions
under its execution lock, as research already does. No new function, ledger,
quota subsystem or default limit is needed.

Regress persisted preparation (uncharged), one failed diagnostic child (charged
before the runner, with nonzero provider usage), reload/replacement task, and
refusal at the existing proposed-count >= hard threshold without another charge.
Reject stale snapshots and paused execution; preparation remains available.
Keep published accounting state as the report-ingestion basis.

The debug conductor reloads child state already. Verify that provider accounting
which pauses a run stops same-loop follow-up research/replanning/automatic retry;
a paused conductor must not launch a child when explicitly resumed as a call
without an actual state transition. Preserve post-run evidence reconciliation.

This closes diagnostic launch admission and this conductor's pause boundary,
not every child entrypoint, inner tool/query limits, unknown-cost reservations,
semantic tactic novelty or complete SC-11/15. Existing budget threshold semantics
remain unchanged. New regressions must reproduce the gap, then focused debug,
budget and conductor checks, build, full unit/mock/conformance gate and fresh
exact-head independent review precede merge.
