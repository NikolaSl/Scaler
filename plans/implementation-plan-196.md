# PLAN-196 — Completed review proposal to manual author assessment

Extend PLAN-189's existing three configured cases, preserving all original cases
and assertions. Add a variant in which the external finding originates in a
completed, attempt-bound conductor child report and is loaded from the actual
report ledger before the manual author records a disposition. Reuse existing
task/context/report/validation APIs; add no production code or review subsystem.

Fixture original request: local-only provider, no cloud or plugin framework.
Scripted comparison child receives those exact sources and candidate, no tools,
one permitted child call (inclusive spawnedAgents hard2). It returns completed
with a finding, not candidate acceptance. The caller loads the admitted report,
persists its identity/summary as the existing required review input, and cites
that same proposal in each manual author assessment. Assert the child alone
does not accept the candidate or change requirements.

Retain unsupported-extra/local-candidate, material-remote/repair-only-candidate,
and inconclusive/required-blocked cases. Objective local-only validation still
checks actual candidate content; review or author labels alone cannot make a
remote candidate pass. Changed review input invalidates accepted reuse. The
author decision is supplied by the fixture/caller, not generated or semantically
certified. The manual adversarial gate is not reviewer provenance.

This proves only caller-sequenced report-to-author data flow and the configured
objective acceptance controls. It does NOT establish automatic selection, a
required author-assessment-omission guard, arbitrary findings resolution, model
quality/independence, actual local inference, or full SC-10/P4/P5. Source-first
expectation and replacement-review cap remain separate PLAN-194 evidence; do not
claim they are integrated here. If existing behavior suffices, production stays
unchanged. A missing combined proof is not itself a runtime bypass.

Before acceptance: focused cases/build, applicable full exact-candidate gate,
source/AC-first fresh independent review and valid-finding disposition; inspect
live PR state and merge expected head with method merge. No paid external model
use, deployment, new automation or weakened manual negative validation. Existing
user authorization ends 2026-10-26T23:08:20Z; hand off/release before that cutoff.
