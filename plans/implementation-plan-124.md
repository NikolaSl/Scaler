# PLAN-124 — P3 measured tool-route assessment

## Observed acceptance gap

PLAN-123 proves the installed Pi host can select the first-request tool set,
compose only the selected instructions, and bind the selected definitions to a
stable identity. It does not choose among the SC-08 routes. The recorded profile
`byteSize` is the size of SCALER's type-tagged canonical identity; it is not the
serialized provider payload, a token count, or evidence of savings.

The existing tool-request executor always prepares or launches an isolated Pi
worker. Pi exposes tool metadata and active-set APIs but no generic tool
execution adapter. Adding a route field to the request record now would therefore
create misleading evidence: execution would ignore it, and the long-lived
decision would immediately become stale as model, history or policy changes.

## Bounded unit

1. Add a pure, request-specific advisory assessor returning
   `direct | current-agent | isolated | blocked`. It MUST set
   `executionAuthorized: false` and MUST NOT execute a tool, activate tools,
   spawn a worker, consume approval, reserve budget or complete a request.
2. Direct eligibility requires authority already confirmed by the trusted
   caller, exact validated arguments and an explicitly available deterministic
   adapter. The installed Pi host has no generic adapter, so arbitrary MCP calls
   remain ineligible for direct execution.
3. Model-route candidates supply complete concrete provider payload legs,
   model and strict admission policy, plus explicit additional bounded context
   not already serialized into each payload. Reuse
   `assessProviderRequestAdmission`; never infer fit from PLAN-123 metadata size.
4. Every leg must fit its own effective model/task limit after its additional
   bounded context. Aggregate safe-integer upper bounds compare feasible route
   overhead only; they do not replace per-request admission. Repeated legs have
   an explicit positive safe-integer bound.
5. Unknown result/context bounds, malformed payloads, unsupported providers,
   unknown or denied authority, an unknown tool profile, unsafe arithmetic and
   unavailable capabilities fail closed with explicit reasons. Known zero
   remains distinct from unknown.
6. A documented capability/focus/evidence-independence isolation requirement
   may exclude the current-agent candidate. Otherwise choose the smallest
   feasible aggregate estimate, with a deterministic current-agent tie break.
7. Bind the advisory assessment to hashes of the persisted request content,
   selected profile, concrete payload/model/policy evidence and capability
   inputs. Schema, prompt, source, model, window, policy, request or bound changes
   must change the binding.
8. Provide an internal helper that loads an existing request and appends only a
   compact, non-authorizing assessment event. Do not add runtime-owned numeric
   evidence to the model-facing `scaler_tool_request` schema or make execution
   consume the recommendation in this unit.

## Test-first evidence

- exact validated operation with supported adapter recommends direct; missing
  adapter/validation/authority does not;
- identical request and tool identity changes feasibility under 8k and 32k
  provider windows using actual serialized payloads;
- one selected small tool can fit while the actual whole-catalog payload does
  not; profile metadata bytes are never used as provider-envelope bytes;
- small schema plus oversized fixed instructions/history blocks;
- isolated worker fit plus oversized caller continuation blocks isolation;
- both model routes fit and current-agent wins when its measured aggregate is
  lower or equal; isolated wins only when lower or explicitly required;
- unknown versus zero bounds, invalid numbers, overflow, unsupported payloads,
  changed profile/model/policy/request evidence and denied authority fail closed;
- audit output contains hashes and measurements but no raw secret-bearing
  request, arguments or provider history, and assessment invokes no executor.

Run the focused routing/provider/tool-request tests, then build, full unit, mock
integration and conformance/autopilot gates. Two independent GPT-6 Astra/high
reviews inspect the exact final head.

## Explicit limits

This unit is policy/evidence plumbing, not AC-08 completion. It does not add a
direct adapter, dispatch through the current agent, attach strict provider
admission to isolated execution, enforce result bounds, prove cost savings or
local-model quality, or grant authority. A later unit must recompute and bind an
assessment at the actual dispatch boundary before any route can be executed.

## Implemented evidence

`src/tool-routing.ts` now exposes a pure advisory assessment over runtime-owned
evidence. It recommends `direct`, `current-agent`, `isolated` or `blocked`, but
always returns `executionAuthorized: false`. Direct advice requires confirmed
authority, exact validated arguments and a named deterministic adapter. Model
routes reuse strict provider admission for each concrete payload leg and add
only separately declared bounded context before comparing safe aggregate upper
bounds.

Leg roles make route completeness explicit: current-agent evidence requires a
`request` leg, while isolated evidence requires exactly one `worker` and one
`caller-continuation` leg. Unsupported roles, missing/duplicate roles, malformed
policies, ids, enums, profiles or name arrays, unknown bounds and unsafe
arithmetic all fail closed. Returned and persisted assessments normalize
malformed evidence to compact primitives so rejected raw objects cannot leak
through the audit path.

`recordToolRouteAssessment` reloads the durable request, binds the decision to
request/evidence hashes and records compact measurements without storing raw
provider payloads or authorizing execution. Focused routing/provider/tool-request
tests pass 63/63 after the review-driven regressions. The final full gate and
exact-head review evidence are recorded in the phase handoff rather than treated
as proof of AC-08 completion.
