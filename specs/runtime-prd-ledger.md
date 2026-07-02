# SCALER Runtime PRD Ledger Spec

## Purpose

The runtime PRD ledger preserves the polished PRD, requirement records, task links, coverage state, and PRD revisions for a specific Scaler run.

It gives replanning and execution deterministic inputs instead of relying on compressed conversation memory or informal summaries.

## Scope

The runtime PRD ledger is project-local runtime data under `.scaler/prd/`.

It is separate from:

- the project-level SCALER assignment (`assignement.md`)
- implementation traceability artifacts (`requirements-catalog.md`, `traceability-matrix.md`, `gap-backlog.md`)
- long-term external memory under `.scaler/memory/`

## Required artifacts

A Scaler run should be able to maintain:

```text
.scaler/prd/
  current.md
  requirements.json
  coverage.json
  changes.jsonl
  versions/
    PRD-vNNN.md
```

### `current.md`

The latest polished runtime PRD for the active user request/run.

It should contain the clarified requirements that planning and execution are currently following.

### `requirements.json`

Structured requirement records with stable ids.

Each requirement should include at minimum:

- id
- statement
- created time
- updated time

Optional fields may include:

- title
- source/reference

### `coverage.json`

Explicit requirement coverage records.

Coverage status values:

- `pending`
- `in_progress`
- `implemented`
- `validated`
- `blocked`
- `needs_replan`

A coverage entry should include:

- requirement id
- status
- updated time
- linked task ids where known
- evidence references where known
- notes when useful

### `changes.jsonl`

Append-only change ledger for PRD/requirement updates.

Each change should include:

- timestamp
- reason
- source when known
- affected requirement ids when known
- version snapshot path when a snapshot was created

### `versions/`

Versioned snapshots of the runtime PRD.

Snapshots preserve previous PRD states before major edits, replanning, or requirement changes that could affect execution.

## Requirement and task linkage

Execution tasks should be linkable to runtime PRD requirement ids.

Task-to-requirement links are used to:

- show what requirement a task supports
- compute requirement coverage from validated tasks
- detect unlinked requirements before or during planning
- preserve validated progress during replanning

## Coverage computation

Coverage may be computed from both explicit coverage records and linked task state.

Rules:

1. Explicit `blocked` and `needs_replan` statuses take precedence over derived task status.
2. Validated linked tasks may derive `validated` coverage when no higher-priority explicit blocker/replan status exists.
3. Linked but not validated tasks may derive `in_progress` or implementation-related coverage when practical.
4. Requirements with no explicit coverage and no linked tasks remain `pending`.
5. Coverage summaries should report counts by status, unlinked requirements, and task-linked requirements.

## Replanning integration

Before replanning, Scaler should make the runtime PRD ledger available to the planner in compact form:

- current PRD reference or summary
- requirement list
- coverage summary
- blocked or `needs_replan` requirements
- validated task links
- recent PRD change records
- relevant version snapshot references

Replanning should preserve validated progress and avoid invalidating completed requirement coverage unless execution evidence proves the requirement or previous task result is obsolete.

## Stage integration

### Stage I — PRD polishing

The PRD agent should create or update the runtime PRD ledger when it clarifies requirements.

### Stage II — knowledge collection

The knowledge agent may add requirement evidence references, uncertainty notes, or change records when research changes requirement interpretation.

### Stage III — planning

The planner should link planned tasks to runtime requirement ids and identify unlinked requirements.

### Stage IV — execution

Execution and validation should update requirement coverage through task state, explicit coverage records, or both.

## Active context rule

Do not inject the entire runtime PRD ledger into every agent call.

Use the context resolver to include only:

- relevant requirement ids/statements
- coverage status for the current task
- concise ledger summaries
- references to full PRD/versions when needed

## Logging

PRD ledger writes, coverage changes, requirement updates, task links, and version snapshots should be logged in the audit trail.
