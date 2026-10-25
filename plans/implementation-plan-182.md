# PLAN-182 — Respect explicit task necessity disposition

SC-03/27 distinguish required work from optional enhancements and unresolved
necessity. PLAN-181 made original wording available, but existing plan admission
only checks links/contract shape: even a task explicitly marked optional can be
published when it has a plausible PRD link.

Add one optional task field, `necessity: required | optional | unresolved`, to
the existing plan contract/tool schema. Reuse `validateExecutionPlan` to reject
any supplied value other than `required` before publication/application. Reject
unknown/malformed values rather than normalizing them away. Optional suggestions
belong outside executable plan tasks, not in a second backlog subsystem.
Legacy omission retains existing structural admission and makes no necessity
claim. A `required` label is a proposal, not proof of semantic necessity.

Regress a well-linked CSV export plan with an optional scheduler or unresolved
plugin prerequisite: no requirement, plan, report or task publication. Cover
direct application, current/proposed persistence and replan acceptance through
the shared validator. Preserve an ordinary compact plan and explicit `required`
control, including round-trip retention. Stage/replan prompts explain the narrow
boundary without adding reviewer calls.

No semantic classifier, new helper/ledger/role, risk-trigger completion, waiver
workflow or complete SC-03/04/10/27 claim. Run focused plan/tool/prompt checks,
build, full unit/mock/conformance gate and independent exact-head review before
merge. If original intent is misclassified or the field omitted, the broader
semantic assessment remains open; do not advertise this as full necessity proof.
This unit guards execution-plan routes, not independent direct task creation or
updating task necessity after a plan has already been applied. Those contracts do
not yet carry this disposition; omission is deliberately not inferred as proof.
