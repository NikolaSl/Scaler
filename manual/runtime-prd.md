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
```

`/scaler-prd-status` loads the runtime PRD requirements, explicit coverage entries, and current task state, then prints deterministic coverage counts and requirement/task links.

`/scaler-prd-link` updates an existing task's `prdRefs` metadata. A task list shows PRD refs when present. Structured `scaler_planning_report` output can also create/update runtime requirements, save the execution plan, create/update planned tasks, align task `prdRefs`, and write coverage diagnostics before execution.

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

## Tools

Implemented runtime PRD tools:

- `scaler_prd_write` writes `.scaler/prd/current.md` and optionally replaces `requirements.json`. It can snapshot the previous current PRD first.
- `scaler_prd_requirement_update` upserts one requirement and optionally updates its explicit coverage entry.
- `scaler_planning_report` ingests planner output, links requirements to plan tasks, and records `.scaler/reports/planning-reports.json` diagnostics.

These tools are intended for PRD/polishing or planning agents to keep the runtime PRD ledger current while execution progresses.
