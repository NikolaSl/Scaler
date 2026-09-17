# PLAN-113 — Require declared outputs at task skip admission

## Scope

PLAN-111 guards final completion, and PLAN-112 transports a declared basis from
planning. Close the remaining per-task skip route: automatic non-Git/clean-Git/
runtime-only acceptance and explicit commit skip must refuse an omitted
outputPaths declaration. A passing command remains a factual passing command;
it cannot alone promote the task to validated or publish an accepted skip.
Real commits retain their actual committed-output proof path and do not gain an
unrelated mandatory manifest field.

Use the existing receipt verification before the output-basis check. A missing
basis requires explicit declaration and fresh validation; do not infer [] from
a worker report or replay validation automatically. [] is an explicit claim of
no filesystem outputs, whose adequacy/authority remains separate policy work.

## Ordered work

1. Commit this plan. Reproduce automatic and direct missing-basis acceptance
   across non-Git, clean/runtime Git and explicit allowed-change skip.
2. Add the guard at existing effect boundaries before accepted skip publication.
   Preserve ledger/state on direct refusal. Keep prior command results factual.
3. Update only affected fixtures with their actual output basis. Existing
   completion unknown-coverage tests must still seed historical accepted ledgers
   and verify rejection, rather than disappearing behind the new earlier guard.
4. Run focused tests and full build/unit/mock integration/conformance. Save
   implementation and evidence separately; completed exact-head Copilot review
   before dependency-ordered merge with expected SHA.

No paid provider, deployment, mandatory Git/container, fake non-software command
or new authority flag. Final semantic/integration acceptance and authorization of
criteria/declaration changes remain open; P2.3 is not complete.

## Result and fixture migration

Six baseline failures reproduced automatic non-Git, clean Git and runtime-only
skip acceptance and explicit non-Git, clean and allowed-change skips without a
declaration. All now refuse. Passing command status is retained independently
of acceptance; direct refusals do not publish accepted skips or change task state.

The broader gate exposed 30 unit and 7 mock-integration fixtures missing an
explicit basis. File cases now declare result.txt, output.txt, fixed.txt,
src/app.js, src/skip.ts or a checked absence. Orchestration/command-status cases
explicitly declare []; their generated runtime markers are validation probes,
not task deliverables. No production default or automatic legacy declaration was
added. Original acceptance, lock, dependency, retry and lifecycle assertions remain.
Git-flag regressions additionally assert Git candidate identity directly so the
new declared-output guard cannot mask removal of that independent protection.

Historical unknown-coverage completion fixtures explicitly seed the accepted
ledger/task labels that older code could produce, after asserting new per-task
admission refuses. Their completion/restart rejection assertions remain intact.
Final gate: build, 696 unit, 67 mock integration and 7 conformance/autopilot pass.

Next: inventory remaining P2.3 acceptance/policy authority and integration gaps
against requirements before selecting the next concrete regression. Digests and
declarations do not establish authorized criteria or semantic correctness.
