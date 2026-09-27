# PLAN-152 — P3 research answer reaches the next task attempt

## Status

Implemented on `implementation/v2-p3-proportional-routing`; PR #24 is the only
PR in review and needs an actual review on its current head.

## Observed gap

An unknown-path `needs_data` request enters local research. Refresh currently
marks the request resolved from a complete or partial report and stores a
conclusion in the request ledger, but the next task manifest and prompt do not
contain that answer. A report for a different task can also match the shared
research request id, and a partial report may leave the requested information
unknown. This can unblock a worker while starving it of information.

## Bounded unit

1. Accept only a complete report tied to the exact research request and task,
   with at least one sourced conclusion and no unresolved unknowns or
   contradictions. A partial/incomplete report remains visible without
   claiming resolution.
2. Persist a bounded, attributed report answer as required inline task context
   before changing the missing-context request to resolved. Carry report id,
   source identifiers/paths and conclusion summaries; distinguish research
   claims from exact source bytes. Existing prompt admission applies at retry.
3. Block conflicting manifest identities or oversized report answers, and
   preserve the file-request and other non-research flows.

This does not perform natural-language search, endorse source truth, infer a
file/section or automatically approve task decomposition. A worker can ask for
the exact source after receiving the attributed research answer.

## Evidence and limits

The prior implementation failed two new tests: a complete report unblocked the
task without supplying its conclusion to the next prompt, and a partial or
foreign report could resolve the request. The implementation requires a matching
complete report with sourced conclusions and no unresolved unknowns or
contradictions, persists a bounded attributed answer in the task manifest, and
then resolves the request. Conflicting existing answer identities stay pending.
An idempotent retry does not duplicate context. This is a report snapshot, not
a live fingerprint of the sources it cites, and it cannot prove the report's
truth or completeness. Manual answers and exact source discovery remain open.

The executable candidate passes the TypeScript build, 1,158/1,158 unit,
68/68 mock integration, 7/7 conformance/autopilot and 61/61 focused
missing-context/research/conductor tests plus `git diff --check`.
