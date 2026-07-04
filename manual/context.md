# Context Resolver and Task Context Manifests

SCALER resolves task-agent context from structured context items and per-task context manifests.

## Context items

Context items include:

- `id`
- `type`: `prd`, `knowledge`, `memory`, `file`, `task_report`, `validation`, `tool`, or `decision`
- `reason`
- `priority`: `required`, `useful`, or `optional`
- `scope`: `full`, `section`, `snippet`, `summary`, or `reference-only`
- `exactness`: optional `exact`, `summary-ok`, or `reference-only`
- `content`

Current behavior:

- required items are always included
- useful/optional items are omitted when over budget
- included items are ordered by priority
- omitted items are summarized so task agents can request missing context explicitly
- task-agent prompts include deterministic compression guidance and exact-preservation rules

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

When SCALER creates a missing manifest, it also discovers and ranks relevant context from available local ledgers:

- non-runtime git changed paths, including readable changed files with task allowed-path matches ranked above unrelated changed files.
- the current execution-plan entry for the task.
- runtime PRD requirement and coverage records for the task's PRD refs.
- the latest validation runs for the task.
- memory index entries matched against task id, title, PRD refs, allowed paths, tags, summaries, and task-linked memory metadata.

Existing manifests are preserved; discovery only runs when a manifest is created.

If a source cannot be resolved, SCALER preserves a `MISSING CONTEXT` item instead of silently dropping it.

## Missing-context lifecycle

Task agents must report missing data instead of guessing. When an accepted `scaler_task_report` uses `status=needs_data`/`blocked` or includes `missingData`, SCALER creates normalized requests under:

```text
.scaler/context/missing-requests.json
```

Each request records status, kind (`memory`, `file`, `local_research`, `internet_research`, `user`, or `tool`), task/report links, query, source hint, PRD refs, evidence refs, and result summaries. `/scaler-missing-context-run` can resolve file/memory requests, dispatch local/internet research requests, or mark user/tool requests blocked for explicit action. `/scaler-missing-context-resolve` records an operator/user answer. Once all missing-context requests for a blocked task are resolved, SCALER moves the task back to `ready`; `/scaler-step` also refreshes research-backed missing-context resolutions before selecting the next task.

## Compression and exact preservation

SCALER uses deterministic compression policy helpers for task-agent prompts:

- Active context target defaults to 75% of the task token budget.
- Context is classified by exactness:
  - `exact`: preserve unchanged; do not paraphrase code, commands, identifiers, API signatures, contracts, requirements, or validation evidence.
  - `summary-ok`: may be compressed into task-relevant conclusions with evidence refs.
  - `reference-only`: keep ids/paths/refs unless retrieval is explicitly needed.
- Large exact items are recommended for externalization to memory/files with stable references instead of lossy summary.
- If resolved active context exceeds the 75% target, the prompt recommends splitting work or spawning a fresh minimal-context agent after exact data has been externalized. Conductor preparation/execution records `.scaler/context/splits.json` artifacts for these oversized contexts with exact refs, summary/reference refs, externalization candidates, and minimal-context handoff recommendations.

Default/discovered manifests mark file snippets, task metadata, validation evidence, execution-plan entries, changed paths, and PRD coverage as `exact`; memory summaries are `summary-ok`; PRD id-only links are `reference-only`. Summary/reference-only memory items inject id/title/path/tags/summary only; full memory content is injected only when a context item or retrieval request asks for `full`, and `section:<heading>` retrieval injects the matching Markdown section when found.

## Commands

```text
/scaler-context-init [taskId]
/scaler-context-status [taskId]
/scaler-context-splits [taskId]
/scaler-memory-search [query] [tag=a,b] [task=T-001]
/scaler-missing-context [taskId]
/scaler-missing-context-run [requestId] [execute] [internet]
/scaler-missing-context-resolve <requestId> | <summary> | <evidence refs>
```

`/scaler-context-init` creates a default manifest for the specified task, current task, or first non-terminal task.

`/scaler-context-status` displays a manifest summary for the specified task, current task, or first task.
