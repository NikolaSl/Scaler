# PLAN-193 — Accepted dependent evidence after prerequisite mutation

SC-03/06/10/12 require current input versions and rejection of stale acceptance.
PLAN-192 checks dependencies during validation, not their later reuse. Reproduce
through public task/validation/evidence/conductor APIs before choosing a fix.

Accept DECISION with declared `decision.txt`, then COPY with declared `copy.txt`
and explicit dependency on DECISION. Its objective command checks exact equality
of both files. Neither task has a model attempt; this is supported configured
non-software validation, not a real provider/model run. A third ready USE task
depends only on COPY. After acceptance, change only the original decision bytes.
First demonstrate DECISION evidence itself is stale. COPY evidence must also
refuse reuse, and USE must not reach its injected runner. Positive controls keep
the basis unchanged or modify an unrelated file; both preserve COPY evidence and
permit one USE runner invocation (deliberate exit1; admission witness only).

The dependency edge explicitly declares the acceptance input. The validation
command reads DECISION's output, but its manifest does not separately duplicate
that output in validationInputPaths: this probes whether task dependency evidence
is intrinsically preserved, not whether manually duplicated source bindings work.

This is regression preparation, not an accepted fix. Avoid a recursion-only
shortcut that would make old COPY evidence fresh again merely because DECISION
is subsequently revalidated on different bytes. Before implementation, assess a
minimal version-bound dependency receipt using existing snapshots/ledgers, with
fail-closed legacy dependent receipts, cycle handling and transitive checks.
Preserve independent tasks and no-dependency compatibility. No generic graph
framework, automatic semantic inference, all-route authority or full phase claim.
No RED merge/full-green gate claim; exact-head independent preparation review
does not replace the eventual fix gate/review.

Implementation decision: extend the existing integration-input fingerprint with
the declared dependency closure and versioned dependency-basis material. Reuse
participant task/policy/context/output/commit-or-skip fields; include each
dependency's current requirement/input validity and historical receipt snapshot.
Do not include validation event IDs/timestamps, so an identical-basis rerun need
not invalidate unrelated evidence. Check dependency receipt integrity, accepted
state and committed outputs; reject malformed/missing/cyclic chains. Existing
no-dependency fingerprint shapes stay unchanged; old dependent receipts cannot
prove the new basis and therefore require revalidation. No new ledger or executor.

Add a supported affected-only replan/revalidation scenario rather than resetting
validated state. Preserve the original two RED probes and unrelated controls;
add same-basis revalidation, transitive, legacy and cycle controls as applicable.

Expanded baseline: three RED / three PASS, including an actual accepted
affected-only replan and successful DECISION v2 revalidation while COPY remains
historically validated. The same route without a basis change is a positive
control. No raw task reset is used; supervisor source invalidation is supplied
through the coverage ledger. With the fix, all ten focused cases pass, including
transitivity, structurally valid old dependent receipts, no-dependency
compatibility, and explicitly injected cyclic/malformed state refusal.
Initial setup corrections: give plan task titles their known fixture string type,
and preserve the validation-run index `{version,runs}` shape in the legacy probe.
Neither correction changes acceptance assertions or production behavior.
Full exact-head gate and independent fix review are still required and recorded
in the PR; preparation review alone was not fix approval. No full phase claim.

Independent fix review found two valid material gaps in the first candidate:
selected participant fields did not cover a dependency's own integration or
attempt/report freshness, and Git commit-to-clean-skip changed provenance without
changing the accepted basis. New tests reproduce both freshness escapes and the
Git compatibility failure. Reuse the full accepted-evidence verifier, with a
per-snapshot shared promise map (never a persisted freshness cache) so DAG checks
do not multiply recursively. The closure guard rejects cycles before recursion.
Dependency provenance is verified but fingerprinted as a stable accepted basis,
not the current commit/skip representation. Existing integration-only shapes are
unchanged. The ESM cycle is function-only with no top-level binding access;
build/focused execution verify initialization instead of adding a new module.
All 24 focused tests pass after these fixes. The initial candidate's full green
gate was not acceptance; a new exact-head full gate and material-fix re-review
are required. Git setup uses the real locked commit operation before acceptance;
its earlier missing explicit commit/state promotion was a fixture error, not the
commit-to-skip regression. Retain both failure and final evidence logs.
