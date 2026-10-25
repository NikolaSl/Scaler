# PLAN-177 — Bind raw research attribution to declared sources

SC-21 requires retained research provenance. After PLAN-176, normalized report
validation precedes raw memory publication, but rawEvidence.sourceId is still
written as a research source label without checking that the source exists.

Regress a batch with a valid first excerpt and an unknown sourceId on its second
excerpt: reject before any memory/report write or request resolution. Preflight
every explicit raw source reference against normalized report sources; normalize
its sourceId consistently when writing memory. Keep omitted/blank sourceId as
unattributed research rather than inventing or requiring a source.

Use existing code paths, no new schema/function/store. This validates identity,
not source truth, excerpts, semantic relevance or source independence, and does
not provide cross-ledger I/O rollback or complete SC-21 acceptance. Focused
research/memory tests, build, full applicable gate and independent exact-head
review precede PR acceptance.
