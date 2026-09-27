# Model-profile eligibility

SCALER exposes a deterministic, non-authorizing eligibility assessment for
configured model-capability profiles. It is a policy prerequisite for local-only
execution, not a model-runtime configuration or proof that a model can complete
a task.

## Profile evidence

A version 1 profile declares:

- one exact API/provider/model/context-window identity;
- whether execution is local or remote;
- the exact tokenizer or conservative estimator identity;
- explicit supported/unsupported structured-output and tool capabilities;
- configured input and output limits;
- every possible data location; and
- observed supported or unsupported task classes with durable evidence refs.

Missing, unknown, malformed, sparse, contradictory or duplicate profile evidence
invalidates the complete configured set. SCALER does not retain a valid-looking
subset from a malformed set.

```ts
const assessment = assessModelProfileEligibility([
  {
    version: 1,
    profileId: "local-core-v1",
    model: {
      api: "openai-completions",
      provider: "local-llama-cpp",
      id: "qwen-local",
      contextWindow: 16_384,
    },
    locality: "local",
    tokenizerEstimator: { id: "qwen-tokenizer-v1", kind: "tokenizer" },
    structuredOutput: "supported",
    tools: "supported",
    limits: { maxInputTokens: 12_000, maxOutputTokens: 2_000 },
    dataLocations: ["host-local"],
    taskSuitability: {
      "bounded-code-edit": {
        status: "observed-supported",
        evidenceRefs: ["evidence:local-core/code-edit-01"],
      },
    },
  },
], {
  version: 1,
  taskClass: "bounded-code-edit",
  localOnly: true,
  allowedDataLocations: ["host-local"],
  requiresStructuredOutput: true,
  requiresTools: true,
  requiredInputTokens: 4_000,
  requiredOutputTokens: 1_000,
});
```

## Decision semantics

The assessor checks task suitability, locality, every possible data location,
required structured output and tools, configured input/output limits and the
exact model context window. It sorts normalized profiles by profile id and binds
the decision to normalized requirement and profile fingerprints.

`eligibleProfileIds` contains every eligible identity; there is deliberately no
selected or fallback identity, and `executionAuthorized` is always `false`.
An empty eligible set is `no-eligible-profiles`, not permission to use an ambient
cloud provider or a paid/stronger model.

## Current boundary

No installed command consumes this assessment for dispatch yet. It does not read
credentials, configure a local host, call inference, measure hardware use or
establish model quality. AC-09 still requires a documented local host/model,
representative real process traces, retained resource evidence and truthful
outcomes, including an explicit blocker for work beyond configured capability.
The model selects candidate subtasks and scoped context; the supervisor validates
those proposals under the current state and explains each role in its prompt.
Completion rates belong to separate task-specific evaluation, not the process gate.
