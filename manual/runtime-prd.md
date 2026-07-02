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

`/scaler-prd-link` updates an existing task's `prdRefs` metadata. A task list shows PRD refs when present.

## Task linkage

Tasks may store `prdRefs` during creation/update:

```text
/scaler-task-create T-001 | Add parser | src,test | | REQ-001
/scaler-task-update T-001 | | ready | src,test | | REQ-001,REQ-002
```

Coverage computation treats validated linked tasks as validated coverage unless an explicit `blocked` or `needs_replan` coverage entry exists for that requirement.

## Tools

Implemented runtime PRD tools:

- `scaler_prd_write` writes `.scaler/prd/current.md` and optionally replaces `requirements.json`. It can snapshot the previous current PRD first.
- `scaler_prd_requirement_update` upserts one requirement and optionally updates its explicit coverage entry.

These tools are intended for PRD/polishing or planning agents to keep the runtime PRD ledger current while execution progresses.
