# PLAN-118 — Remaining P2 acceptance work

## Scope and delivery

This phase branch builds on PR #21 / PLAN-117 and must not merge before that
prerequisite. Nikola requested coherent phase PRs with separate logical commits,
not a new PR per small plan or fix. Keep this plan incremental; refine each next
unit from a concrete failure and the revised acceptance scenarios.

Current branch: `implementation/v2-p2-acceptance`. The renewed work window and
review/delegation/reporting rules are recorded in PLAN-099.

## Unit A — Bind both supported requirement-link directions

AC-27 requires task evidence to remain tied to current requirement content.
`computePrdCoverageSummary` unions task `prdRefs` with coverage-ledger `taskIds`.
PLAN-117's receipt fingerprint currently reads only `prdRefs`. Therefore an
explicit coverage-only link can count toward completion without binding its
requirement content to the linked task's validation.

1. Reproduce completion after changing an explicitly linked requirement and
   after adding a coverage-only link following validation.
2. Fingerprint the canonical union of both supported link directions. Reuse
   existing receipts and acceptance guards; add no ledger or duplicate state.
3. Preserve valid unchanged/idempotent evidence, relevant-slice isolation, and
   the unlinked-task fast path that avoids reading requirement content.
4. Verify direct receipt checks and completion; run impacted suites and the
   build/unit/mock-integration/conformance gate before claiming success.

This does not prove semantic link sufficiency, requirement authority, immutable
requirement history or end-to-end integration criteria. Schema v3 already has
the requirement-content fingerprint; the change corrects selection of its
material, so receipts omitting explicit-only links naturally require revalidation.

## Next acceptance boundary to refine

AC-26/27 requires current requirement-level and cross-task integration evidence.
Passing linked task checks alone cannot discharge a separately declared
integration criterion. Inspect existing manifests, command execution and receipt
verification before choosing a minimal representation. Do not introduce a
mandatory extra agent/task or silently infer extra acceptance requirements.

Authority of policy changes and independent non-software evidence remain
explicit gaps; neither a source label nor a model's success claim grants them.
This plan is not a declaration that all P2 requirements are satisfied.
