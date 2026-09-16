# Three-Mode Tool and MCP Routing
Requirements: SC-08, SC-14. Acceptance: AC-08, AC-14.

## Modes

| Mode | Use when | Model exposure |
|---|---|---|
| Direct deterministic | Exact validated arguments/operation are already available | No additional LLM transaction |
| Current-agent tool | Reasoning is needed, relevant context is already present, and selected tool fits | Only selected tool schemas/guidance/results |
| Isolated tool agent | Specialized docs, iterative investigation or noisy results would overwhelm/disrupt the caller | Task-specific tool context in a bounded worker; concise result to caller |

Routing is per request and selected tool set, not a permanent classification of
an entire MCP server. A large server can still offer a cheap individual tool.
A direct call may have been prepared by an earlier agent; it needs no second
agent merely to execute validated arguments.

## Tool profile: how size is known

Discover and cache, when available:
- Tool identity, server/adapter identity, schema version or fingerprint.
- Serialized parameter schema, exposed descriptions and prompt guidelines.
- Additional documentation that the chosen operation actually needs.
- Estimated tokens under the selected tokenizer/estimator.
- Known output size bounds; pagination/filter/streaming/reference support.
- Required capabilities, side-effect class, permission scope and idempotency.
- Observed iterations, usage and failures from comparable requests.

Measure only selected tools when the host supports selection. If the host injects
the entire catalog, account for that actual footprint. Unknown size MUST remain
unknown until bounded inspection or conservative estimation establishes a route.

## Routing procedure

1. Check action authority and whether exact inputs can execute deterministically.
2. Estimate the incremental current-agent envelope:
   selected schemas + required docs + bounded result + expected continuation.
3. Compare with remaining admissible context AFTER fixed instructions, current
   task, output reserve and safety margin. Configurable per-model thresholds may
   classify a tool as small, medium or large; no global fixed-token cutoff is a
   correctness rule.
4. Compare feasible routes' expected total overhead, including worker setup,
   transferred task context, report, caller continuation and expected iterations.
   Estimates may be simple and uncertain; record their basis.
5. Choose the least-overhead feasible route. Isolation may also be justified by
   capability, focus or evidence independence. Reassess if observed size differs.
6. Bound outputs and iterations; keep raw evidence retrievable and return only
   relevant results. If no route fits, split/retrieve differently or block.

Do not spawn an LLM to discover a schema available deterministically from MCP.
Do not assume isolation is cheaper: duplicating instructions and context has cost.
No route bypasses action permissions, validation, budgets or effect reconciliation.

## Reports and execution

Record request/attempt identity, chosen route/reason, exact redacted invocation,
outcome, concise answer, artifact references, usage and uncertainty.
Repeated/paginated calls are bounded. Retry must obey SC-14 for side effects.
Documentation and tool output are data, not authority to expand permissions.

Multiple requests may be queued, but the current workspace policy executes them
sequentially. Parallel fan-out is a future optional profile, not current scope.
