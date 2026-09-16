# Proportional Orchestration
Requirements: SC-04. Acceptance: AC-04.

## Decision

Before work, choose the lightest feasible execution route:
1. Deterministic operation when inputs and behavior are already known.
2. Current reasoning session when relevant context is present and bounded.
3. Isolated agent when separation or a different capability justifies setup cost.

Do not spawn an agent for every task, role label, file read or validation command.
A task boundary and an agent boundary are different decisions.

## Evidence used

Assess scope, uncertainty, consequence of failure, dependency structure, available
evidence, relevant context size, capability fit and expected execution/retry cost.
Request length, language or words such as Docker MUST NOT alone determine risk.
If evidence is missing, use a bounded inspection/clarification; do not automatically
start the heaviest workflow.

Use deterministic defaults/heuristics for routine cases. An LLM may propose a
decomposition when reasoning is needed, but its proposal remains subject to guards.
Record the selected route, reason and estimate uncertainty without requiring a
new model call just to explain every routing decision.

## Escalation and de-escalation

Escalate only the deficient dimension: retrieval for missing facts, a new agent
for context isolation, review for consequential uncertainty, or an authorized
capability for a capability gap. A test failure does not automatically require
PRD polishing, deep research and a new global plan.

Reassess at task boundaries or material new evidence. Do not oscillate on every
minor signal. Reuse accepted findings and authorization. Simplify remaining work
when the original reason for extra process no longer applies.

Stage I–IV MAY remain a convenience template. No fixed complexity level, stage
count, reviewer count or separate document is necessary for core compliance.

## Checks of direction

Define inspectable risk triggers for checking the interpretation of the original
request, plan coverage and scope necessity under SC-03/SC-27. Assess triggers
before consequential execution and after material changes. Examples include
large decomposition, costly-to-reverse commitments, proposed acceptance changes,
conflicting evidence and repeated failure of a central hypothesis.
Triggering MUST NOT depend solely on a worker reporting low confidence or a test
failing: an incorrect interpretation can be confident and pass its own tests.

Use the least costly adequate check: explicit constraint checks, a discriminating
experiment, or an independent evidence-backed assessment under SC-10. A second
model MAY provide that assessment when authorized and useful. Routine, low-risk
work with adequate objective checks MUST NOT require another LLM by default.
Record the trigger, selected check and its outcome/limitations. If a required check
is unavailable or inconclusive, use a policy-authorized adequate alternative or
block the affected decision; do not silently downgrade it to optional.

The supervisor enforces recorded gates, versions and budgets. It MUST NOT claim
to establish semantic truth merely because a record passes structural validation.
