# Context Resolver and Task Context Manifests

SCALER resolves task-agent context from structured context items and per-task context manifests.

## Context items

Context items include:

- `id`
- `type`: `prd`, `knowledge`, `memory`, `file`, `task_report`, `validation`, `tool`, or `decision`
- `reason`
- `priority`: `required`, `useful`, or `optional`
- `scope`: `full`, `section`, `snippet`, `summary`, or `reference-only`
- `selector`: file-backed `section` items use
  `{ "kind": "markdown-heading", "heading": "...", "maxChars": N }`;
  `maxChars` defaults to 3,200
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

Operators can also run deterministic semantic-style candidate search without injecting the results. Candidate search scores task metadata, query terms, memory summaries/tags, allowed files, changed files, PRD refs, and existing manifest items, then returns a small candidate list with reasons. Candidates become active only after explicit approval into the task manifest.

If a source cannot be resolved, SCALER preserves a structured unavailable
`MISSING CONTEXT` item instead of silently dropping it. Required unavailable
items refuse conductor and debug-retry dispatch before attempt, task transition
or spawned-agent accounting.

File-backed `section` scope is exact document-level Markdown ATX-heading retrieval,
not prefix truncation. A pinned CommonMark parser distinguishes headings from code,
HTML, blockquotes and lists; headings inside those containers are not selectable.
Setext headings are not selectable but do end a preceding section at equal or
higher level. The selector matches the unique raw heading text (including inline
Markdown syntax), without rendering or semantic inference.
Only ASCII spaces/tabs are trimmed from selectors and heading text. Unicode
spacing characters (including NBSP) remain part of the exact heading identity.
Retrieval includes its nested subsections and stops before the next equal-or-higher
heading while preserving the original substring and line endings. Missing,
ambiguous or oversized selections are unavailable; SCALER does not truncate them
while claiming exactness. Two selectors may reference distinct sections of the
same file. CRLF, standalone CR and LF line endings are preserved in the returned
substring. If a heading position cannot be mapped back to the original source,
the context is unavailable rather than approximately selected.

## Final prompt admission

Execution uses the task manifest allowance, an explicit caller allowance, or an
8,000-token default. Allowances must be positive safe integers; malformed
explicit or persisted values fail closed. Conductor and debug retry estimate the
complete SCALER-owned prompt after context resolution and wrapper construction,
including a fixed-length execution-attempt identity envelope. An oversized
prompt is refused before runner dispatch, attempt creation, task `running`
transition, or spawned-agent accounting. Required exact bytes are not silently
dropped or summarized to force admission. Prepare mode and split diagnostics
remain available because they do not launch a worker.

This early estimator remains the documented `characters / 4` approximation.
Executable conductor and debug-retry children then use a second, stricter gate
at Pi's `before_provider_request` boundary. For the supported OpenAI Chat
Completions text/tool payload emitted by installed Pi 0.80.3, SCALER counts the serialized UTF-8 bytes
of the final provider request. That conservative upper bound includes Pi system
instructions, tool schemas, history, injected context, pending tool results and
protocol fields. The gate adds the provider's actual output limit and a 1,024
token safety margin, then compares the total with both the task allowance and
the selected model context window. Pi output clamping below the required 1,024
token useful reserve is also refused.

Strict children disable ambient extension, skill, prompt-template and context
file discovery, load the admission extension last, and reject extra extension
paths. Policy transport contains validated numeric limits only. A refusal calls
`ctx.abort()` before the transport; a thrown hook error is not treated as
enforcement. The strict profile also cancels Pi's provider-backed compaction,
whose summary request bypasses `before_provider_request` in Pi 0.80.3.

The provider gate currently supports only the installed Pi 0.80.3 OpenAI Chat
Completions text/tool shape. Alternate APIs, image/audio and multiple-completion
payloads fail closed. The byte bound can conservatively reject a request that an
exact tokenizer would admit. Parent interactive calls, other child routes,
provider-internal retries and reconciliation against observed usage remain
later P3 work.

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
- Large exact or summary-ok items are deterministically externalized to `.scaler/memory/` when a context split is recorded, preserving full content with a memory id/path, SHA-256, token estimates, and exactness metadata.
- If resolved active context exceeds the 75% target, conductor preparation/execution records `.scaler/context/splits.json` artifacts for these oversized contexts with exact refs, summary/reference refs, externalized memory refs, and minimal-context handoff recommendations.
- SCALER registers a Pi `session_before_compact` hook that returns a deterministic SCALER-aware compaction result and records `.scaler/context/compactions.json`. Turn-end context usage above the target triggers `ctx.compact()` with SCALER state-preservation instructions.
- SCALER registers a Pi `context` hook that injects only approved manifest items for the current task when they are compact (`summary`, `snippet`, or `reference-only`) and non-optional. Full and optional items remain pull-based and are not automatically inserted into the parent-session LLM context.
- Fresh minimal-context continuation handoffs are recorded in `.scaler/context/handoffs.json` with prompt artifacts under `.scaler/context/handoffs/`; execution is blocked unless the generated handoff prompt is below the active-context target and smaller than the split context.

Default/discovered manifests mark file snippets, task metadata, validation evidence, execution-plan entries, changed paths, and PRD coverage as `exact`; memory summaries are `summary-ok`; PRD id-only links are `reference-only`. Summary/reference-only memory items inject id/title/path/tags/summary only; full memory content is injected only when a context item or retrieval request asks for `full`. Memory's `section:<heading>` retrieval remains separate from file-manifest selectors.

## Commands

```text
/scaler-context-init [taskId]
/scaler-context-status [taskId]
/scaler-context-candidates [taskId] [query] [limit=N]
/scaler-context-approve <taskId> <candidateId> [query]
/scaler-context-splits [taskId]
/scaler-compact
/scaler-compactions
/scaler-context-handoff [splitId|taskId] [execute]
/scaler-context-handoffs [taskId|splitId|handoffId]
/scaler-memory-search [query] [tag=a,b] [task=T-001]
/scaler-missing-context [taskId]
/scaler-missing-context-run [requestId] [execute] [internet]
/scaler-missing-context-resolve <requestId> | <summary> | <evidence refs>
```

`/scaler-context-init` creates a default manifest for the specified task, current task, or first non-terminal task.

`/scaler-context-status` displays a manifest summary for the specified task, current task, or first task.

`/scaler-context-candidates` lists scored memory/file/PRD/manifest candidates without changing the manifest or active context.

`/scaler-context-approve` adds the selected candidate to the task manifest unless an equivalent memory/file/content item is already present.

`/scaler-context-splits` lists oversized context records and their externalized memory refs.

`/scaler-compact` requests Pi compaction with SCALER-aware preservation instructions. The `session_before_compact` hook writes deterministic compaction records to `.scaler/context/compactions.json`.

`/scaler-compactions` lists recent compaction records and summary artifact paths.

`/scaler-context-handoff` prepares a fresh minimal-context continuation from a
split record only after revalidating the split, current manifest, every selected
minimal item, and each externalized source's stored identity and bytes. The
legacy `execute` argument now fails closed before invoking a runner because this
route does not yet have conductor-equivalent attempt, provider and result
admission. Execute prepared work through the normal conductor boundary.

`/scaler-context-handoffs` lists fresh handoff records.
