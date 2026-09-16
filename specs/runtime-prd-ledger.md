# Runtime Requirement Ledger
Requirements: SC-27. Acceptance: AC-27.

## Identity and content

Maintain stable runtime requirement IDs and versioned statements for the user's
active work, distinct from SCALER's own SC-* product requirements.
Record source/authority, scope, constraints, acceptance criteria, assumptions,
unresolved questions, changes and evidence references.

Preserve retrievable original user wording and subsequent authorized decisions
separately from normalized interpretations and implementation assumptions. An
agent's deduction or a review suggestion MUST NOT become a user requirement
without an authority basis. Necessary implementation steps link to requirements
as prerequisites; they do not acquire independent user authority by being recorded.

A small run may use one compact requirement. Do not require a polished standalone
PRD document or a PRD agent when the user's request is already precise.

## Coverage

Link tasks and outputs to specific requirement versions.
Check both missing coverage and unnecessary work at every planning/decomposition
boundary under SC-03. Each task links directly or through an inspectable necessary
prerequisite chain; thematic association alone fails the check. Review findings
and new acceptance conditions are subject to the same rule. Optional enhancements
stay outside executable scope until authorized.
Distinguish planned, attempted/implemented, evidence-accepted, blocked and obsolete
coverage. Links or counts of validated tasks alone MUST NOT establish fulfillment.
Requirement-level and cross-task integration criteria also need current evidence.

Changes preserve old statements and acceptance history. Assess which plans,
memories, outputs and validations become stale when a requirement changes.
Do not carry accepted coverage automatically to a materially revised statement.
Explicitly superseded requirements are retained historically, not forced into
future task plans.

## Active context

Expose the relevant requirement slice, constraints and unresolved questions,
not the entire ledger. Large-ledger queries must be bounded and indexed as needed.
The exact persistence format is an architecture decision.
