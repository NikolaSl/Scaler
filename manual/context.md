# Context Resolver and Task Context Manifests

SCALER resolves task-agent context from structured context items and per-task context manifests.

## Context items

Context items include:

- `id`
- `type`: `prd`, `knowledge`, `memory`, `file`, `task_report`, `validation`, `tool`, or `decision`
- `reason`
- `priority`: `required`, `useful`, or `optional`
- `scope`: `full`, `section`, `snippet`, `summary`, or `reference-only`
- `content`

Current behavior:

- required items are always included
- useful/optional items are omitted when over budget
- included items are ordered by priority
- omitted items are summarized so task agents can request missing context explicitly

## Task context manifests

Per-task manifests live under:

```text
.scaler/context/tasks/<taskId>.json
```

Manifest sources currently supported:

- `inline`
- `file`
- `memory`
- `state`
- `task`
- `prd_refs`
- `validation_manifest`

When `/scaler-step` runs without explicit context items, SCALER loads or creates the task context manifest and resolves it into the task-agent prompt.

Default manifests include supervisor state, task metadata, validation manifest, runtime PRD refs when present, and supervisor memory refs.

If a source cannot be resolved, SCALER preserves a `MISSING CONTEXT` item instead of silently dropping it.

## Commands

```text
/scaler-context-init [taskId]
/scaler-context-status [taskId]
```

`/scaler-context-init` creates a default manifest for the specified task, current task, or first non-terminal task.

`/scaler-context-status` displays a manifest summary for the specified task, current task, or first task.
