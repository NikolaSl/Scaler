# PLAN-178 — Admit research children through the existing agent budget

SC-15 includes research/child usage; SC-21 requires bounded investigation.
`runResearchAgentStep` currently dispatches without consulting or incrementing
the existing run-level `spawnedAgents` budget. Repeating an unresolved request
can therefore bypass a configured child limit across worker replacement.

Reproduce that boundary with a persisted run and injected runner: preparation
does not consume allowance; one executed child consumes it even without a valid
report; after reload, another request cannot dispatch at the existing hard
threshold. Preserve request/report history and do not charge a refused launch.
Exercise nonzero provider usage so it cannot overwrite the launch accounting.

Reuse `applyBudgetUsageUpdates` and `persistBudgetDecision` under the existing
execution lock. Refuse stale snapshots before admission; carry the published
state into provider accounting. Keep existing budget threshold semantics, no
new counter, default policy, quota schema or research subsystem.

This bounds research child launches only when the shared budget is configured;
it does not enforce query/page caps inside a child, semantic search novelty,
unknown costs, all other child routes or full SC-15/21 acceptance. Focused tests,
build, full unit/mock/conformance gate and fresh exact-head independent review
are required before merge.
