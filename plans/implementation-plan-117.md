# PLAN-117 — Bind validation receipts to current requirement content

## Authority and baseline

This bounded P2.3 unit follows merged PLAN-116 / PR #20. AC-10, AC-26 and
AC-27 require accepted evidence to stay bound to the current requirement
version. PLAN-116 checks structural coverage at completion, but a linked task's
receipt currently binds only its requirement ids when no task-attempt context
manifest exists.

## Reproduced defect

Validate and accept a task linked to a runtime requirement, then materially
change that requirement's statement while retaining its stable id. The task
contract and receipt still match, computed coverage remains `validated`, and the
run can complete using evidence produced for the earlier requirement text.

## Bounded change

Extend the supervisor-created validation snapshot with a canonical fingerprint
of the current content of requirements referenced by the task. Bind stable id,
statement, title and authority source; exclude timestamps so an identical
idempotent upsert does not invalidate evidence. Include missing referenced ids in
the fingerprint so later creation/removal also changes the binding.

Bump the validation snapshot schema version. Existing receipts require
revalidation rather than being silently migrated or treated as current. Reuse
the existing receipt comparison at validation, commit/skip, dependency admission
and completion boundaries; do not add another ledger.

## Acceptance and limits

1. Reproduce false completion after a linked requirement statement changes.
2. Preserve completion when the linked requirement content is unchanged, and
   show an identical metadata upsert does not invalidate it.
3. Verify missing-to-present reference changes reject old evidence.
4. Run focused checks, build, full unit/mock integration and conformance gates.
5. Preserve plan, regressions, implementation/migration and result docs as
   separate commits; require exact-head Copilot review before merge.

This proves byte-canonical binding to the selected runtime requirement fields.
It does not establish that a link is semantically sufficient, that an integration
criterion passed, or that task scope is necessary/minimal.

## Result

Two baseline regressions confirmed false completion after a linked requirement
statement changed and after a previously missing referenced requirement appeared.
The validation snapshot is now schema version 3 and binds the sorted current
requirement slice (`id`, `statement`, `title`, `source`, or an explicit missing
marker). The existing receipt verifier therefore protects validation,
commit/skip, dependency admission and completion without another ledger.

An identical content upsert remains valid because timestamps are excluded.
Schema version 1 and 2 receipts fail closed and require revalidation. Final gate:
TypeScript build, 717 unit tests, 67 mock integration tests and 7
conformance/autopilot checks pass. Semantic sufficiency, integration criteria,
necessity and requirement-authority validation remain open.
