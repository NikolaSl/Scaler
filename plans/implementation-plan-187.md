# PLAN-187 — Direct task-input necessity disposition parity

PLAN182 refuses explicit optional/unresolved execution-plan entries. Direct
`createTask`/`updateTask` input currently ignores the same supplied disposition;
the task tools do not transport it. SC-03/27 require optional suggestions to stay
outside executable work. Close this narrow alternate-input gap, not semantic
necessity assessment.

Add the existing optional necessity vocabulary to create/update input schemas
and forward it through their registered tools. Refuse any explicitly supplied
value except `required` before task/state/validation-policy/quality publication.
Reject malformed raw values too. Preserve omitted legacy input and explicit
required proposals. No new helper, ledger, runtime task field or policy defaults.
This is an admission assertion, not a persisted necessity proof or an instruction
to stop an existing accepted task when a rejected update proposes optional work.

Regress create/update and registered tool transport with valid-looking task
contracts and plausible PRD links. Verify persisted state and validation policy
unchanged on refusal, and keep ordinary omitted/required controls. Input omission
or required label does not prove necessity. Low-level state helpers/imported state,
downstream execution re-assessment and full SC-03/27 remain outside this unit.
Keep PLAN185's gate-not-actor correction and PLAN186 limitations unchanged.

Build, focused task/tools tests, full unit/mock/conformance, own review and
independent exact-head review before merge. No model-quality/local-inference
claims, paid external calls, deployment, acceptance weakening or new subsystem.
