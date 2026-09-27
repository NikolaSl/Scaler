# PLAN-147 — P3 exact direct catalog execution

## Status

Implemented and validated on the P3 preparation branch; phase review and merge
remain pending.

## Observed prerequisite gap

The route assessor can recommend `direct` for an authorized request with exact
validated arguments and a named deterministic adapter. The execution boundary
currently accepts only `isolated`, so AC-08's known exact operation cannot yet
execute without a model call.

## Bounded unit

1. Add one durable direct-operation shape for the built-in read-only
   `builtin:tool-catalog-entry-v1` adapter. Its only argument is one exact tool
   name; malformed, empty, padded, unknown-adapter or mismatched requests fail
   closed.
2. Include the direct operation in request identity and the host-owned live
   route basis. Recompute the route immediately before claiming execution and
   require the fresh assessment to recommend `direct` with the same adapter.
3. Bind request, adapter arguments, selected-tool evidence and a synthetic
   non-process invocation to one authorized direct execution. Preserve the
   existing active-execution ownership, serialized-result limit and exactly-one
   result acceptance checks.
4. Execute only a deterministic lookup of the requested tool's compact local
   catalog entry. Record zero model usage and do not invoke Pi, MCP, shell,
   filesystem mutation or a caller-provided callback.
5. Keep isolated execution and its provider/continuation admission unchanged.

## Test-first evidence

- an exact direct catalog lookup completes with one accepted bounded result and
  never calls the model runner;
- the transaction records `route=direct`, the exact adapter and zero provider
  usage;
- missing/malformed/padded arguments, unknown adapters, route/adapter mismatch,
  request drift and result overflow fail closed;
- an isolated recommendation continues through the existing isolated path;
- prepare-only requests and legacy requests without a direct operation retain
  their behavior.

Run focused routing/tool-request tests after meaningful changes, then the full
TypeScript build, unit/component, mock-integration, conformance/autopilot and
diff gate on the candidate.

## Explicit limits

This unit does not provide a generic direct callback, arbitrary tool or MCP
execution, filesystem reads/writes, current-agent dispatch, production
continuation wiring, local-model execution, quality, savings or scale evidence.
It closes only AC-08 scenario (a) for one runtime-owned exact read-only
operation; SC-08/AC-08 remains Partial.

## Implementation evidence

- `test/tool-requests.test.ts` first reproduced zero-model direct execution,
  adapter mismatch and malformed exact-argument gaps before implementation.
- `src/tool-requests.ts` persists and fingerprints one exact direct operation,
  recomputes a runtime-owned route at dispatch, binds a synthetic invocation to
  execution ownership, and accepts one bounded catalog result without calling
  the task-agent runner.
- `src/tools.ts` exposes only the literal built-in adapter and its one exact
  catalog-name argument through `scaler_tool_request`.
- Follow-up regressions cover durable argument drift and oversized result
  refusal; isolated dispatch behavior remains covered by the existing suite.
- The exact-head candidate passes the TypeScript build, 1,145 unit/component
  tests, 68 mock integration tests, 7 conformance/autopilot tests, 101 focused
  routing/request/tool tests and `git diff --check`.
