# PLAN-137 — P3 fail-closed model-profile eligibility

## Observed prerequisite gap

PLAN-132 binds every strict child to the exact model selected by the installed
host, but the bound identity contains only API, provider, model id and context
window. Nothing currently represents or checks the remaining profile facts
required by SC-09: locality, tokenizer/estimator, structured-output and tool
support, configured limits, data-location restrictions and task-specific
observed suitability. A caller can therefore prove identity without proving
that the model is eligible for the task or an explicit local-only constraint.

This is a prerequisite for honest local-only execution evidence. It is smaller
and safer than configuring a provider, running inference or integrating a new
automatic router.

## Bounded unit

1. Define a versioned model-capability profile with an exact provider-admission
   identity, execution locality, tokenizer/estimator identity, structured-output
   and tool support, configured input/output limits, data-location restrictions
   and per-task-class observed-suitability evidence.
2. Define a request-specific eligibility requirement covering task class,
   local-only and allowed-data-location constraints, required structured output
   or tools, and the complete required input/output envelope.
3. Validate profiles and requirements structurally and fail closed on unknown,
   malformed, sparse, duplicate or contradictory capability evidence. Unknown
   capability is never treated as success.
4. Return a deterministic, non-authorizing eligibility assessment for every
   configured profile. Eligibility is constrained by task capability, locality,
   data scope and limits before any preference; an empty eligible set is an
   explicit blocked result, never an implicit cloud or paid fallback.
5. Preserve the exact provider-admission identity so a later dispatch unit can
   bind an eligible decision to the already enforced PLAN-132 transport gate.

## Test-first evidence

- a documented compatible local profile is eligible for its observed task class;
- an otherwise compatible remote profile is excluded by a local-only request;
- unknown or negative task suitability, tool support, structured-output support,
  tokenizer identity or data-location evidence blocks eligibility;
- an oversized input/output requirement is rejected against both configured
  limits and the exact model context window;
- malformed, sparse and duplicate profiles fail closed without partially
  selecting another profile;
- profile order does not change the normalized assessment or eligible identities;
- no eligible profile produces an explicit blocked assessment with bounded
  per-profile reason codes and no fallback identity.

Run the focused model-profile tests after each meaningful change and the full
build, unit/component, mock-integration, conformance/autopilot and diff gate on
the candidate.

## Explicit limits

This unit does not read credentials, install or configure a model runtime, call
any model, measure quality or hardware resources, choose a profile for dispatch,
authorize execution, change the host-selected model, implement automatic
multi-model routing or silently fall back to cloud/paid inference. It does not
complete SC-09/AC-09; real documented local-host execution and retained resource
and outcome evidence remain P7 acceptance work.
