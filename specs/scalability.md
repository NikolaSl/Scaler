# Large-Run Scalability
Requirements: SC-23. Acceptance: AC-23.

## Bounded active work

Large projects MUST use bounded plan/context/report slices rather than loading
the full project ledger into each model request or every scheduler operation.
Support coarse milestones, incremental refinement, bounded ready-frontier
selection and indexed/paginated retrieval of historical records.

Individual execution decisions SHOULD depend on relevant dependencies and current
state, not all raw historical payloads. Some indexing/reconciliation work may
scale with history; make its cost and scheduling explicit.

## Artifacts and control overhead

Keep large outputs external; stream/bound transport buffers and retrieval.
Deduplicate immutable evidence when useful. Cache only version/authority-valid
results. Batch related deterministic operations when safe and useful.
No distributed cluster, vector database or concurrent agents is required.

## Declared operating envelope

Publish supported task/history/artifact counts, context limits, representative
local machine/model configuration and measured controller latency/memory.
Choose concrete scale fixtures and thresholds before implementing the associated
performance gate. Proposed starting fixtures are 100, 1,000 and 10,000 task records
with fixed active frontier; these are test sizes, not a current capacity claim.

Measure growth with task/history volume and identify bottlenecks. Do not claim
unlimited scale or infer scalability solely from small unit tests.
