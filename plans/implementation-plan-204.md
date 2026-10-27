# PLAN-204 — Catalog-only explicit requirement supersession

Preparation for one executable AC-12/27 boundary, not implementation approval.
The public-route diagnosis on main `1c980484` is retained at PR65 comment
6431150070: authorized same-ID statement amendment works and preserves history;
distinct-ID OLD/NEW has no structured supersession contract. Text saying
"superseded by NEW" is not that contract. Do not parse it as retirement authority,
delete OLD, or claim the existing coverage refusal is a semantic-inference bug.

## Smallest first supported contract

Extend the existing parent-user revision-checked amendment contract with an
optional `supersededBy` requirement ID. Absence preserves legacy active behavior.
The target must already exist and be active, differ from OLD, and the operation
must include OLD's exact revision and a nonempty authorized reason. Supersession
is terminal in this first profile: no implicit clearing/reactivation or retargeting.
Keep OLD's statement, criteria, source and prior versions; append the explicit
decision with the resulting revision, target, user-command authority and reason.
Do not add an inference engine, separate ledger or optional LLM call.

Initially admit this operation only while the run has NO runtime tasks and NO
tasks in either current or proposed execution plans. Otherwise refuse without
changing state, requirements, coverage or history, naming unsupported existing-
work reconciliation. This deliberately does not retire pending/accepted/shared
tasks, replay effects or delete contracts. It is a catalog-preparation profile,
not full AC-12. Do not silently broaden it to existing tasks to pass a fixture.

Active coverage/planning/completion obligations exclude explicitly superseded
records; exact historical retrieval retains them. Keep known IDs distinct from
active obligations so history does not become unknown or new executable scope.
New task create/update, planning reports and direct/accepted plan application
must refuse executable refs to retired IDs before their publication. Model/child
upserts, catalog replacement and ordinary statement/source edits cannot designate,
clear or forge supersession. Parent-command forwarding and history normalization
must use the actual public contract, not an invented mock-only field.

## Concrete implementation/acceptance work

Use a catalog-only fixture OLD="initial note", NEW="replacement note". Explicit
user supersession OLD revision1→2 must retain exact history and admit a minimal
NEW-only plan without artificial OLD work; real note validation and current
completion must still enforce NEW's criterion. Retired OLD-only task/plan proposals
refuse. A statement-only "superseded" edit remains active. Same-ID amendments,
legacy absent-field records, normal minimal plans and unaffected requirements
remain compatible. Check unknown/self/retired targets, stale revisions, model and
child forgery, rollback/clear attempts, and terminal decision behavior.

For any existing runtime task (pending, ready, accepted or shared) or any current/
proposed plan task, assert refusal and complete preexisting byte/state/history
preservation. These are refusal controls, NOT successful task retirement evidence.
Exercise stale replan basis and active replacement criteria. An empty catalog-
preparation phase is not a completed run. Imported arbitrary state/host effects
and later-task retirement remain separately unverified.

Before production, prove a common serialization/fencing boundary between the
empty-task/plan check and supersession publication, including actual task creation
and planning. `createTask` is NOT wrapped wholesale by the validation-policy lock
today; do not assume that taking that lock alone excludes it. Reuse existing locks
and revision checks where sufficient; reproduce a controlled competing-public-
writer case. If no small safe boundary is demonstrated, keep this preparation
unmerged and revise/split rather than publish a racy field-only patch. No generic
transaction framework is prescribed; recoverable refusal is preferable to an
unjustified guarantee.

First implement regressions against the actual explicit contract extension,
distinguishing new-capability expectations from historical product RED. Then own
review and focused/build/full exact-head unit/mock/conformance/diff gate plus fresh
source/rubric-first independent review and finding dispositions before acceptance.
No assertion/timeouts/caps weakened or broad green sampling. Preparation alone
does not justify a PR/merge, phase upgrade, semantic truth/local inference/scale
claim or a new authorization window. SC03/04/10 remain Partial, P4/P5 incomplete;
P6/P7 separate. No paid inference/deployment/new automation. Handoff/release and
stop before current cutoff2026-10-27T22:50:08Z.

The first executable prerequisite is shared writer fencing, not the supersession
field. Hold the existing production validation-policy lock, invoke actual task
creation and direct current/proposed plan writers, assert pending/no publication,
then release/drain and assert real publication. Preserve reentrant planning paths
and stale-state rejection. Initial regressions must demonstrate which writers
actually escape; do not infer serialization from a lock's name. This prerequisite
alone does not implement supersession or establish a multi-ledger transaction.
