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
current task contract, selected attempt/output identity, validation policy,
context, declared outputs and stable commit/skip acceptance kind. Reaccepting a changed component
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

## Unit B result

The two negative baseline scenarios failed before implementation: completion
accepted both a missing named integration command and a declared skip. The
passing end-to-end control remained green. Runtime requirements now accept
normalized optional `acceptanceCriteria`; duplicate criterion ids and malformed
or empty identities fail closed. Omitted criteria survive partial direct,
PRD-stage and planning updates, while explicit `[]` is a deliberate removal.

Completion requires one exact required runnable command with current `passed`
evidence. Receipt schema version 4 binds the owner to the canonical criterion and
to non-owner participant task/attempt/output/policy/context/declared-output and
stable Git commit or reasoned-skip identity. It deliberately does not hash nested
receipts or run ids: this avoids self-invalidating owners and reciprocal rerun
cycles, while changed outputs/contracts/policies still invalidate old integration
evidence. A regression changes and reaccepts one component, proves the older
integration result stale, then reruns the named command successfully.

An independent review found that malformed stage criteria could be parsed as an
omitted catalog after PRD content had already been written. Stage ingestion now
validates the full requirement/criterion payload before every write and rejects
non-string participant ids instead of silently narrowing them. The dedicated
regression preserves both PRD content and requirements on refusal.

Gate: TypeScript build, 731 unit tests, 67 mock integration tests and 7
conformance/autopilot checks pass. A GPT-6 Astra/high read-only design review
found no further actionable defect after the ingestion correction. This is partial
AC-26/27 evidence only. Criterion change authority/history, semantic necessity,
non-software integration evidence and representative real-model outcome quality
remain open.

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
No repository protection, billing or review settings were changed. The user then
authorized the exact-head independent fallback recorded in PLAN-099: primary
self-review plus separate GPT-6 Astra/high correctness and adversarial
requirements reviews, with re-review after every code change. PR #21 may merge
only after that fallback (or a current Copilot review) and all applicable checks
pass; review-request API success alone remains insufficient.

Authority of policy changes and independent non-software evidence remain
explicit gaps; neither a source label nor a model's success claim grants them.
This plan is not a declaration that all P2 requirements are satisfied.

## Unit C — Authorized amendments and immutable requirement history

The current runtime catalog lets every model-facing PRD/planning route replace an
existing statement or explicitly clear its acceptance criteria. Bulk PRD writes
can also omit an existing requirement and delete it from the catalog. The change
ledger records only a generic reason and requirement id, so the earlier wording,
criterion set and claimed authority cannot be reconstructed. `source` is caller
data and MUST NOT be treated as authentication.

Use the smallest fail-closed boundary that matches the authority actually
available in the extension:

1. Existing model/report/tool routes may create an initial normalized requirement
   without mandatory integration criteria or repeat current content idempotently,
   but cannot add, change or remove acceptance criteria, or materially change or
   delete an existing statement, title or source. Omission preserves catalog
   entries and criteria; neither a forged `source` nor an `authorized` payload is
   an authority signal.
2. Add a user-invoked slash-command amendment route, unavailable to child-agent
   tools, with an exact expected revision and a required reason. It applies only
   the supplied fields, fails on a stale revision, and cannot create a requirement.
3. Give normalized requirements a monotonic revision. Append exact before/after
   requirement snapshots and the command authority basis for every accepted
   material amendment. Keep prior evidence historical; existing fingerprints
   make current acceptance stale after the revision content changes.
4. Preflight multi-requirement stage/planning/tool inputs before any PRD, plan,
   task, artifact or coverage write. One unauthorized mutation must leave the
   whole submitted operation unchanged rather than partially applying it.
5. Reproduce silent criterion removal, whole-requirement omission and weak change
   history before implementation. Then cover an authorized amendment, stale-base
   refusal and an agent/report amendment refusal.

This does not authenticate free-form text as original user wording, prove semantic
necessity, or provide non-software evidence. The command is an explicit local user
decision boundary; unattended agents must pause/propose when it is required.

## Unit C result

Three authorization regressions first demonstrated that a forged `source: user`
could change or remove criteria and that stage bulk replacement could weaken or
delete existing requirements. Model-facing PRD, planning, and stage routes now
permit only initial normalization without mandatory criteria or idempotent repeats.
Omitted requirements are preserved. Material changes require
`/scaler-prd-amend`, an exact expected revision, and a user-supplied reason.

The catalog stores monotonic revisions and exact embedded version history with
the authority basis. Revision participates in the acceptance fingerprint, so an
A→B→A content cycle does not revive old evidence. Bulk upserts validate the full
set before publication and update the catalog/coverage under one exclusive PRD
writer lock with atomic JSON replacement. Planning validates its plan before
publishing requirement ledgers. This prevents stale unrelated writers from
rolling back an authorized revision and prevents authorization rejection from
leaving partial catalog, coverage, plan, task, artifact, or change records.

The independent GPT-6 Astra/high review found and drove fixes for the stale-writer
race, batch ordering, source-less stage idempotence, literal pipes in amendment
JSON, and lock initialization cleanup. A final read-only review found no remaining
actionable defect.

Gate: TypeScript build, 743 unit tests, 67 mock integration tests and 7
conformance/autopilot checks pass. No paid or real-model request was made. The
local command is an explicit process boundary, not cryptographic user
authentication; arbitrary filesystem mutation, semantic requirement necessity,
non-software evidence authority and representative outcome quality remain open.

## Next P2 closure unit

Before adding another mechanism, inventory every remaining route that can grant
task/run acceptance or weaken a current requirement and map each route to the
shared receipt/authority guard. Reproduce only concrete bypasses. If the inventory
finds none, record the P2 evidence boundary honestly and move the remaining
semantic-necessity and minimal-planning work to its dependency-ordered phase
instead of extending P2 speculatively.

## Unit D — Close reproduced acceptance-route bypasses

The route inventory reproduced a concrete mismatch in the Git decision boundary.
When validation passes in a clean or runtime-only repository but the manifest
does not declare `outputPaths`, automatic acceptance correctly refuses the task.
Calling the locked commit route afterward reaches `commitValidatedTask`, whose
clean-tree fallback currently publishes an accepted skip without the same output
basis guard, then transitions the task to `validated`.

1. Add a route-level regression proving the validation refusal cannot be turned
   into accepted task state or a commit-skip record through the locked commit
   path.
2. Apply the existing declared-output-basis guard inside the shared direct commit
   effect boundary, before any accepted skip publication. Do not duplicate a new
   policy or trust caller summaries.
3. Continue the bounded route inventory. Add any additional finding to this unit
   only after a deterministic false-acceptance reproduction; keep planning and
   semantic-necessity work in their dependency-ordered phases.
4. Run focused commit/receipt/operations checks and the full applicable gate.

### Unit D result and review evidence

The initial six failing route regressions led to shared clean/runtime skip
output-basis checks, pre-hook versus committed tree comparison, committed/index/
worktree output verification, and dependency evidence admission before validation
commands or budget spend. No-op hooks retain the positive commit control; a
rejected hook-produced commit remains available for diagnosis.

A separate deterministic reproduction showed that model tools could replace a
failing acceptance command and generate fresh green evidence against unchanged
broken output. The model task/manifest/planning routes now refuse exercised
policy and task-contract replacement. Parent user command corrections require a
reason for manifest changes, retain exact previous policy history and advance a
fingerprinted revision. Initial setup and idempotent proposals remain supported.

Two independent GPT-6 Astra/high reviews drove concrete repairs for user-user
read/merge races, mutation during the first validation, planning preflight/publication
races, stale caller state after lock acquisition, and expired inherited lock
ownership. Both final read-only reviews report no actionable finding for the
implementation/test diff with SHA-256
`b75340cda9e1fedf787e75b6e0c4a2099f288b770ea195096bc6f3e003859e14`.
The primary agent also checked the affected callers and lock order. Build,
the 16 focused authority tests, full unit suite, 67 mock integration tests and
7 conformance/autopilot checks pass. This is not a review of the older PR #21
head, nor proof of universal P2 closure.

Remaining limits: raw trusted system APIs and filesystem writers are not
authenticated; the policy lock is not a universal multi-file transaction;
task-only authorized command edits do not yet have the manifest's version-history
format; semantic necessity and non-software evidence remain separate work. No
paid or real-model execution or deployment was used.

Next: preserve this bounded result on the same phase branch, then review the
remaining P2 closure matrix before advancing to P3. PR #21 remains unchanged and
unmerged. The 2026-09-17T22:07Z scheduled instruction repeats a mandatory Copilot
gate despite the earlier direct-user fallback authorization; this continuation
does not merge under that conflict. Keep independent review evidence available
without weakening branch protections or treating an accepted API request as a
submitted review.

## Unit E — Bind executable validation-basis files

The closure audit found one further deterministic AC-10 candidate. Freezing a
manifest command protects its text and metadata, but not the implementation of a
local checker that the command invokes. After a failing run, an agent can leave
the command and broken task output unchanged, remove the failing assertion from
the checker file, and produce fresh green evidence. Git safety may reject a
checker outside the task scope, but the supported non-Git path has no equivalent
identity, and a checker inside a broad allowed scope remains indistinguishable
from an intended task output. A current receipt therefore does not by itself
prove that the originally exercised validation basis was preserved.

Keep this unit explicit and bounded:

1. Reproduce the false acceptance through the normal locked validation route,
   with an unchanged command, unchanged broken output and a modified checker.
   Preserve a control that repairs the output while leaving the checker intact.
2. Add exact project-relative validation-basis paths to the existing manifest
   policy. Bind their file identity when the policy is established and verify it
   before and after command execution. Do not parse shell commands or crawl the
   project tree to guess dependencies.
3. Treat a changed basis as an acceptance-policy change. Model/report routes
   cannot rebaseline it after exercise; the existing explicit user-command
   authority, reason, revision and version-history path can correct a genuinely
   wrong check. An omitted basis remains an explicit unsupported limitation, not
   a claim that arbitrary command dependencies are protected.
4. Transport the optional declaration through the same task/planning/tool paths
   that already carry commands and output paths. Reject malformed, duplicate,
   absolute, traversal and runtime-metadata paths before publication.
5. Run focused authority/receipt/transport checks, then the full applicable
   build, unit, mock-integration and conformance gate. Obtain fresh independent
   exact-diff review after implementation changes.

This mechanism protects declared local checker files; it does not prove that the
declared set is semantically complete, interpret arbitrary shell behavior, or
replace later representative outcome evaluation. Those limitations must remain
visible in P2 closure evidence and P7 validation.

### Unit E result and review evidence

The baseline regression first showed a normal failed validation becoming accepted
after only the declared command's checker implementation was weakened. The fixed
path binds normalized exact regular-file bytes into policy history and validation
snapshot schema v5. Current receipt, direct commit/skip, dependency admission and
completion checks all reject basis drift; repairing only the task output remains
a passing control.

Task, manifest, planning, stage and replan inputs carry the optional declaration.
Malformed or duplicate paths fail closed. Model authority cannot rebaseline an
exercised policy, while the existing reasoned user-command amendment advances the
revision and retains the prior policy. Policy save authorizes the exact snapshot
it persists, preventing a double-hash race. Planning preflights both explicit and
preserved declarations before any requirement, plan or task publication.

Two GPT-6 Astra/high exact-diff reviews found and drove fixes for duplicate-path
collapse, policy-save TOCTOU, explicit and inherited planning partial publication,
and then reported no remaining actionable correctness issue. Final validation:
TypeScript build, full unit suite, 67 mock integration tests and 7
conformance/autopilot checks pass.

This is bounded AC-10 evidence for explicitly declared local validation files.
Undeclared dependencies, semantic declaration sufficiency, arbitrary trusted
filesystem writers, non-software evidence and representative real/local-model
outcome quality remain open. Do not mark P2 or SC-10 complete from this unit.
