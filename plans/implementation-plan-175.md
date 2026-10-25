# PLAN-175 — Bound admitted debug approaches across a run

## Observed boundary

SC-11/SC-15 require finite aggregate tactic limits that survive worker/task
replacement and resumption. `recordDebugReport` currently accepts arbitrarily
many `next_approach` reports; those records have no run identity. Per-invocation
debug-loop maxSteps does not constrain later invocations.

## Minimal executable fixture

Configure a run-level `tacticChanges` hard limit of 1 through the existing budget
limits representation. Persist and reload that run. Admit one evidence-referenced
`next_approach`; accept identical delivery of its stable report ID without a
second charge. After another reload, reject a distinct report under another task
ID before publishing it. The first report and its evidence remain recoverable.

## Intended implementation boundary

Use the existing report ledger as the admission history and serialize its
read/check/publication with an existing bounded non-stealing lock. Bind newly
accepted approaches to the supervisor's run identity, not model input. Count
across tasks in that run. Do not let report edits erase consumed allowance or
idempotent replays overwrite the accepted approach. Reconcile legacy run-less
records conservatively rather than inventing a fresh allowance.

Reassess whether derived usage or the existing state budget counter is the
smaller coherent publication boundary before implementing; do not create a
second independently updated source of truth. A malformed configured limit must
not grant unbounded continuation. The explicit configured limit fixture is not
proof of automatic finite policy on every dispatch path.

## Exclusions and gate

No semantic equivalence classifier, new model/reviewer workflow, general ledger
framework or P5 completion claim. Evidence-reference presence is structural;
the owning gate still validates truth. Report admission is not proof that all
retry dispatches or other tactic routes obey the aggregate limit. Review limits
and elapsed no-progress stopping remain separate acceptance boundaries.

First publish the executable counterexample as a failing regression; implement
only after reviewing this boundary. Then focused debug/budget checks, build,
full unit/mock integration/conformance gate and independent exact-head review
are required before a phase PR is accepted. No red preparation branch is merged.

Implementation uses the report ledger alone for consumed allowance, with
run-bound immutable approaches and idempotent replay. `tacticChanges` is now
a recognized configuration key; no default cap is invented. The CLI's generic
usage counter is not admission authority for this derived ledger count.
