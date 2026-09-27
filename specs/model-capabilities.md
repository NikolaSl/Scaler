# Local Models and Capability Selection
Requirements: SC-09. Acceptance: AC-09.

## Model profile

The system MUST support at least one documented local-only model/host combination
for core process acceptance scenarios. No cloud credential, cloud fallback or
network inference is required for that profile. Offline operation may report tasks
blocked when necessary external information is unavailable. The process contract
does not depend on any one model's task-completion rate.

Profiles declare model/backend identity, usable context, tokenizer/estimator,
structured-output/tool support, configured limits, data-location restrictions and
observed suitability for task classes. Unknown capability is not success.

## Selection and limits

Choose among configured, authorized eligible profiles. One model for every role
is a valid initial configuration. Automatic multi-model routing is optional.
Task-specific requirements, context and data scope constrain eligibility before
price preference. Local inference still consumes time, memory and energy.

On repeated format/evidence/capability failure, try bounded repair, reduce scope,
retrieve missing information, or propose an authorized alternative.
Never silently escalate to a cloud service or a paid/stronger model.
Escalation within a preauthorized policy does not require repeated permission.

## Optional review profile

When model review is selected, record the reviewer's capability and what
independence it contributes. A fresh session with the same model separates context
but can retain systematic model errors. A different model/family MAY add diversity;
neither model identity nor agreement proves correctness or eliminates bias.
Use relevant evidence and assess the reviewer under SC-10/SC-24. A weaker or
unassessed reviewer MUST NOT be represented as a guaranteed correctness gate.
No second model, cloud service or automatic model routing is required for the
local-only profile; an unavailable necessary check follows SC-04's blocker policy.

## Proof

Record the actual model, resource envelope, state transitions, validation decisions
and outcomes for local acceptance. The model may propose subtasks and scoped
context; the supervisor checks their necessity, authority, dependencies, input
versions and budget before scheduling, then validates evidence before acceptance.
Clear, state-specific prompts explain the role, available inputs, allowed proposals,
required output and failure behavior. Model output is a proposal, not a state
transition or proof. A model's task-specific success rate can be measured separately;
it is not a gate for the model-independent process contract. Provider-specific
assumptions must remain outside that contract.
