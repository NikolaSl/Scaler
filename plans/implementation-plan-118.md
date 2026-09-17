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

## Unit A result

Six added regressions produced four failures and two passing controls before the
fix. After canonicalizing both link directions, all pass. Changed requirement
text, late-added links, and removed/retargeted links invalidate prior receipts.
Unchanged/idempotent content and unrelated-task links retain valid evidence.

Validation: TypeScript build, 90 focused checks, 724 unit, 67 mock integration
and 7 conformance checks pass. GPT-6 Astra with high reasoning reviewed the fix
and regressions independently and found no actionable defect. This does not
replace the required Copilot review. Duplicate malformed coverage entries,
policy authority and requirement integration evidence are outside this unit.

## Next acceptance boundary — requirement integration evidence

AC-26/27 requires current requirement-level and cross-task integration evidence.
Passing linked task checks alone cannot discharge a separately declared
integration criterion. Inspect existing manifests, command execution and receipt
verification before choosing a minimal representation. Do not introduce a
mandatory extra agent/task or silently infer extra acceptance requirements.

Read-only assessment identified the following implementation direction to refine
before code changes:

1. Represent named requirement criteria with explicit mappings to existing
   task validation command IDs. Transport them through PRD tools, planner reports
   and stage ingestion; partial updates must preserve omitted criteria.
2. Bind criteria/mappings to requirement content and bind integration evidence
   to the participating components' current outputs, attempts and policies.
   A merely current integration-task receipt is insufficient after a different
   component has changed and been independently reaccepted. Avoid recursive
   receipt hashing. Inspect whether a compact requirement receipt using the
   existing command runner is simpler than extending task snapshots.
3. Require actual current passing command evidence and accepted participating
   outputs. A manual status, arbitrary reference, skipped command or unrelated
   passing command cannot satisfy a declared integration criterion.
4. Call the shared verifier from completion and verification of already-completed
   runs. Preserve historical evidence and keep verification read-only.
5. Reproduce two passing component tasks with absent/failing end-to-end evidence;
   add a current integration-pass control. Then change/reaccept one component
   and prove the old integration evidence remains invalid until rerun.

Current `resolveComputedRequirementStatus` promotes a label from any validated
linked task; this remains progress metadata, not proof of requirement acceptance.
Authority for changing/deleting criteria and preservation of structured statement
history need separate treatment before claiming full P2/SC-27 coverage. Do not
turn this direction into a mandatory extra framework or add inferred user scope.

## Unit B — Explicit current integration criteria

Use an optional requirement criterion, declared only by an already-authorized
PRD/planning input. Each criterion has a stable id and statement, names one
existing validation task/command, and lists the component task ids whose current
accepted outputs it integrates. Absence of criteria means none are inferred.
Omitting criteria from a partial requirement update preserves the current list;
an explicit empty list removes it and therefore remains subject to the separate
authority/history gap below.

Completion must reject a criterion unless its named command actually passed in
the current accepted validation run. A skipped, blocked, failed, optional-only,
unknown or unrelated command is not evidence. Criterion data is part of the
requirement content fingerprint. The integration task snapshot additionally
binds a compact, non-recursive identity for every participating component:
current task contract, selected attempt/output identity, validation policy and
latest accepted validation-result identity. Reaccepting a changed component
therefore invalidates older integration evidence until the named command reruns.

Transport the optional criterion through direct PRD tools, structured PRD stage
reports and planning reports. Reuse the existing command runner, validation
receipts, accepted-task verifier and completion lock; add no requirement agent,
implicit task, alternate executor or caller-supplied proof flag.

Acceptance sequence:

1. Two component tasks pass and are accepted, but completion without the
   declared integration command evidence fails.
2. A failed or skipped named command fails; an unrelated passing command fails.
3. The current named passing command permits completion.
4. After a participating component changes and is reaccepted, the old
   integration receipt fails until the named command runs again.
5. Criterion changes invalidate prior receipts; omitted partial updates preserve
   criteria. Focused tests precede the full applicable gate.

This unit proves deterministic software-command integration evidence only. It
does not authorize agents to add/remove mandatory criteria, prove semantic link
necessity, or solve non-software evidence authority. Those remain explicit P2
gaps and must not be claimed complete from this unit.

## Review-delivery diagnostic

PR #21 remains unchanged at `dda6f7cd4502d0b57a8a79ba7fc88a3f2440674b`.
The REST reviews endpoint confirms the only Copilot review belongs to the older
`a951522b305c5ccb89405a3677672f65081870b7` commit. A diagnostic re-request with
the documented bot login succeeded, but a subsequent REST requested-reviewers
read returned empty users/teams; the current head also has zero check runs.
There is no evidence of a pending or completed re-review. Root cause is unknown;
do not interpret the successful mutation response as review execution.

GitHub documents REST review requests and a separate UI re-review action at
https://docs.github.com/en/copilot/how-tos/use-copilot-agents/request-a-code-review/use-code-review?tool=webui.
No repository protection, billing or review settings were changed. Leave PR #21
unmerged until its current changes have a completed review; continue independent
preparation on this phase branch rather than repeatedly requesting or sleeping.

Authority of policy changes and independent non-software evidence remain
explicit gaps; neither a source label nor a model's success claim grants them.
This plan is not a declaration that all P2 requirements are satisfied.
