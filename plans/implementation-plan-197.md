# PLAN-197 — Make the existing planner's necessity assessment mandatory

AC-03 and `specs/replanning.md` require two-way coverage and necessity checks at
initial planning, each decomposition and replanning. The public stage/replan
prompt builders currently say "If necessity is assessed"; neighboring contract
and link checks do not supply this missing responsibility. Fresh source/AC-first
independent assessment confirmed this concrete prompt-contract defect.

Replace that opt-out in the existing planning/replanning prompt surfaces. Require
the proposer to compare requested outcomes/constraints with planned acceptance,
justify tasks against authorized requirements, and state the failing criterion
and simpler-sufficient-approach comparison for disputed prerequisites in existing
descriptions/summary. Keep optional suggestions outside executable work and accept
minimal plans/necessary technical steps without extra confirmation for necessary
steps or agent calls by default; preserve independently applicable required checks.
Do not impose planning duties on unrelated stage activities.

First add focused assertions to the public prompt-builder tests and observe RED;
then change only the prompt instructions. No new field, ledger, guard, semantic
classifier, reviewer call, plan-admission behavior or default workflow. Preserve
the warning that `required`, links and stated rationale are proposals, not proof.

The public API assessment uses well-formed CSV tasks linked to one original
requirement: minimal/escaping controls and falsely-required extras, omitted column
and design-induced prerequisite. Structural admission is not semantic acceptance;
do not turn those observations into a deterministic classifier requirement.

This increment proves only the supplied model responsibility contract, not correct
model reasoning, actual rejection of falsely-required work, nested-decomposition
execution or full AC-03/P4/P5. Coverage remains Partial. No local inference,
quality, savings or scale claim. Before PR acceptance: own review, focused checks,
build/full exact-candidate unit/mock/conformance/diff gate, independent exact-head
review and disposition of findings; expected-head method merge only. No paid
external inference/deployment. Current authority ends 2026-10-26T23:08:20Z;
preserve durable handoff/release ownership before that cutoff.
