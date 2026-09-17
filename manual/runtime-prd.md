# Runtime PRD Ledger

SCALER can maintain a per-run runtime PRD ledger under `.scaler/prd/`. This is separate from the project-level SCALER PRD and traceability matrix.

Implemented artifacts:

- `.scaler/prd/current.md` — polished runtime PRD markdown.
- `.scaler/prd/requirements.json` — runtime requirement records with stable ids such as `REQ-001`.
- `.scaler/prd/coverage.json` — explicit requirement coverage statuses.
- `.scaler/prd/changes.jsonl` — append-only PRD ledger change records.
- `.scaler/prd/versions/PRD-vNNN.md` — versioned snapshots.

Implemented requirement statuses:

- `pending`
- `in_progress`
- `implemented`
- `validated`
- `blocked`
- `needs_replan`

## Commands

```text
/scaler-prd-status
/scaler-prd-link T-001 | REQ-001,REQ-002
/scaler-prd-amend REQ-001 | 1 | User-approved clarification | {"statement":"Clarified requirement"}
```

`/scaler-prd-status` loads the runtime PRD requirements, explicit coverage entries, and current task state, then prints deterministic coverage counts and requirement/task links.

`/scaler-prd-link` updates an existing task's `prdRefs` metadata. A task list shows PRD refs when present. Structured `scaler_planning_report` output can also create/update runtime requirements, save the execution plan, create/update planned tasks, align task `prdRefs`, and write coverage diagnostics before execution.

`/scaler-prd-amend` is the explicit local-user boundary for changing an existing
requirement. It requires the exact current revision, a non-empty reason, and a
JSON object containing only the fields to change (`statement`, `title`, `source`,
or `acceptanceCriteria`). It cannot create a requirement. A stale revision or an
empty/no-op amendment fails without changing the catalog. Literal `|` characters
are permitted inside the JSON payload.

## Task linkage

Tasks may store `prdRefs` during creation/update:

```text
/scaler-task-create T-001 | Add parser | src,test | | REQ-001
/scaler-task-update T-001 | | ready | src,test | | REQ-001,REQ-002
```

Coverage computation treats validated linked tasks as validated coverage unless an explicit `blocked` or `needs_replan` coverage entry exists for that requirement.

Final run completion also checks this current coverage. When runtime requirements
exist, each one must link to at least one task in current state, every recorded
task link must still exist, and the computed status must be `validated`. Add or
replan the missing task and revalidate its evidence instead of relying on a stale
coverage label. This is a structural completeness check; it does not infer or
certify that a task link is semantically adequate.

Validation receipts also bind the current content of every requirement linked
through the task's `prdRefs` or explicit coverage `taskIds`: stable id, statement,
title and source. Both link directions use one canonical requirement set. Changing that
content, or creating a requirement that was missing when validation ran, requires
the task to be revalidated before commit/skip, dependent execution or final
completion. Rewriting identical content does not invalidate evidence merely
because the ledger timestamp changed. Receipts created before requirement-bound
snapshot schema version 3 require revalidation.
Schema v3 receipts captured before explicit-only links were included also require
revalidation when they omit that content. Unrelated tasks' coverage entries do
not change the fingerprint. Tasks with no links in either direction do not read
the requirement-content file; the coverage ledger is still checked for links.

Requirements may optionally declare named `acceptanceCriteria`. A criterion
contains its stable id and statement, the existing validation task and command
that supplies its evidence, and the participating task ids. Criteria are never
inferred merely because several tasks link to the same requirement. Completion
requires the exact mapped command to be required, runnable and actually passed;
skipped, blocked, optional, missing or unrelated commands do not count.

Validation receipt schema version 4 includes normalized criteria and a compact
identity of the participating components. A changed and reaccepted component
invalidates older integration evidence until the named command runs again.
Omitted criteria are preserved by partial direct, PRD-stage and planning updates.
Model-facing tools and structured reports cannot add, change, or remove criteria,
or materially change an existing statement, title, or source. An explicit empty
array therefore fails on those routes. Use the revision-checked local-user
amendment command for an authorized change.

Each requirement has a monotonic `revision` and embedded `versionHistory`. Every
accepted amendment appends the exact resulting content, timestamp, user-command
authority basis, and reason; older versions remain reconstructable. Requirement
fingerprints include the revision, so changing A→B→A still invalidates evidence
captured at the earlier A. Bulk model writes preserve omitted requirements and
are serialized with amendments; one unauthorized item rejects the batch before
catalog, coverage, plan, task, or stage writes.

## Tools

Implemented runtime PRD tools:

- `scaler_prd_write` writes `.scaler/prd/current.md` and optionally merges normalized requirements into `requirements.json`. Omitted catalog entries are preserved. It can snapshot the previous current PRD first.
- `scaler_prd_requirement_update` upserts one requirement and optionally updates its explicit coverage entry.
- `scaler_planning_report` ingests planner output, links requirements to plan tasks, and records `.scaler/reports/planning-reports.json` diagnostics.

All three structured input paths accept optional requirement
`acceptanceCriteria` objects with `id`, `statement`, `validationTaskId`,
`commandId`, and `participantTaskIds`.

These tools are intended for PRD/polishing or planning agents to keep the runtime
PRD ledger current while execution progresses. Their `source` fields are data,
not authentication. They may add a normalized requirement without mandatory
criteria or repeat current content, but an amendment requires the user command.
The lock protects supported writers; arbitrary filesystem tampering and process
identity/containment remain separate security boundaries.
