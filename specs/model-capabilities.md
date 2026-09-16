# Local Models and Capability Selection
Requirements: SC-09. Acceptance: AC-09.

## Model profile

The system MUST support at least one documented local-only model/host combination
for core acceptance scenarios. No cloud credential, cloud fallback or network
inference is required for that profile. Offline operation may report tasks blocked
when necessary external information is unavailable.

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

Record the actual model, resource envelope and results for local acceptance.
Small-model usefulness is a measured task-specific property, not a parameter-count
promise. Provider-specific assumptions must remain outside the task contract.
