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
