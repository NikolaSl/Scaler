# Task and Attempt Contracts
Requirements: SC-02, SC-04, SC-09. Acceptance: AC-02, AC-04, AC-09.

## Useful task boundary

A task MUST have one coherent assessable outcome. Group tightly related changes
when they share context, intent and validation. Split when scopes, input needs,
risks or independent failure modes justify the overhead.
Do not equate atomicity with a line count or a rationale string of minimum length.

## Logical task contract

Before execution, define or inherit:
- Stable task ID, contract version, goal, constraints and out-of-scope work.
- Requirement references; input artifact/source versions and dependencies.
- Expected outputs/artifact types and locations or logical destinations.
- Definition of Done, validation criteria and integration obligations.
- Allowed actions, tools, paths, data destinations and effects.
- Context envelope, execution/resource limits and missing-input behavior.
- Required reasoning/tool capabilities and allowed model/environment profiles.
- Selected executor/route and concise reason.

Defaults MUST be inspectable. Trivial read-only responses may use a compact
in-memory contract plus a durable run outcome; no full document is required.

## Attempt contract

Each attempt MUST have a unique identity tied to the task version, admitted input
snapshot, selected route/model/tools, start/stop outcome and evidence references.
An agent may propose a task-specific role or instructions; roles are templates,
not a fixed organizational hierarchy. Instructions MUST fit the context envelope.

## Result contract

Return status, output references/versions, concise findings, validation observations,
changed files where relevant, created/retrieved memory, uncertainty, blockers,
missing data and next-action proposal. Fields are conditional on relevance, not
mandatory empty boilerplate for every trivial operation.
The supervisor authenticates the attempt association and validates the result.

A worker MUST NOT change its own authority, acceptance criteria or accepted
scheduler state. Requests for more context, scope, tools or budget are proposals.
Communication uses scoped artifacts/reports, not unrestricted agent-to-agent
conversation or inherited full parent history.

## Local model practicality

Use concise, versioned report schemas with clear diagnostics. Permit bounded
repair of malformed reports without rerunning completed external effects.
Separate format errors, insufficient evidence, missing capability and task failure.
No model is assumed capable merely because it can return valid JSON.
