# PLAN-160 — P3 current-agent tool dispatch

## Status

Planned on `implementation/v2-p3-memory-context`; implementation and phase
review remain pending.

## Observed gap

SCALER can advise `current-agent`, but installed execution accepts only its exact
direct adapter or an isolated child with a host-owned live-envelope supplier.
Pi already exposes the smaller host primitives needed for a same-session route:
selected active tools, exact pre-provider payload admission, user-message
delivery and agent lifecycle events. No synthetic child identity or additional
provider adapter is required.

## Bounded unit

1. Add one explicit current-agent command for a prepared, non-direct tool
   request. It must refuse busy sessions, absent runtime selection APIs,
   unavailable requested tools, duplicate active execution, and requests that
   require isolation.
2. Before the induced agent turn, narrow the active set to exactly the request's
   allowed tools plus `scaler_tool_result`, preserve the prior set, and inject a
   route-specific prompt. The prompt states that the agent performs one
   admitted request, may use only those tools, must emit one structured result,
   and cannot advance the supervisor FSM.
3. At every provider call in that agent run, recompute `current-agent` admission
   from the actual payload, exact selected-tool profile, current provider/model
   identity and runtime-owned strict policy. Claim execution only after the
   first successful exact-payload admission; later calls must preserve the same
   model/profile and pass the same checks. Bound provider calls and fail closed.
4. Bind `scaler_tool_result` to the runtime-owned active execution without
   exposing an execution-id input to the model. On agent end, accept exactly one
   fresh bound result under the existing result-size, request-ownership and
   durable-identity checks; otherwise block the transaction.
5. Restore the previous active tools on every normal or refused terminal path.
   A process interruption after the durable claim retains active ownership for
   explicit reconciliation, matching the existing isolated boundary.

## Test-first evidence

- unavailable tools, direct operations, isolation requirements, busy sessions
  and concurrent executions refuse before a provider request;
- the host sees only requested tools plus `scaler_tool_result` and the prompt
  describes the current-agent role and FSM limit;
- malformed, oversized, changed-model, changed-profile and excess provider
  calls abort before traffic or further tool use;
- one exact-bound structured result closes the request; missing, duplicate,
  foreign or oversized results block it;
- active tools are restored after success and refusal, while ordinary parent
  focus and isolated execution behavior remain unchanged.

Run focused tool/extension tests after meaningful changes, then the TypeScript
build, full unit/component, mock-integration, conformance/autopilot and diff
gate before publication.

## Explicit limits

This unit does not wire the isolated continuation-envelope supplier, add generic
direct/MCP adapters, choose or benchmark a local model, infer tasks, broaden
context, or prove quality/savings. It uses the already selected current model
and existing request authority under a bounded host lifecycle.
