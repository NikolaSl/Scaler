# Context Resolver and Task Context Manifests

SCALER resolves task-agent context from structured context items and per-task context manifests.

## Context items

Context items include:

- `id`
- `type`: `prd`, `knowledge`, `memory`, `file`, `task_report`, `validation`, `tool`, or `decision`
- `reason`
- `priority`: `required`, `useful`, or `optional`
- `scope`: `full`, `section`, `snippet`, `summary`, or `reference-only`
- `selector`: file-backed `section` items use either
  `{ "kind": "markdown-heading", "heading": "...", "maxChars": N }` or
  `{ "kind": "typescript-function", "name": "...", "maxChars": N }`;
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

For JavaScript and TypeScript files, `typescript-function` selects one unique
named top-level function declaration or a single-declaration top-level variable
initialized with an arrow/function expression. Selection uses the TypeScript
parser and returns the declaration's original source substring; it does not
render or rewrite code. Supported extensions are `.ts`, `.tsx`, `.mts`, `.cts`,
`.js`, `.jsx`, `.mjs` and `.cjs`. Missing or duplicate names, overload groups,
malformed source, unsupported extensions, multi-binding declarations and
oversized results are unavailable. Class methods, object properties, namespace
members, anonymous defaults, re-exports, cross-file symbols and automatic
selector choice are outside this selector's scope. Candidate discovery can find
this exact selector across the task's bounded allowed paths only when the user
supplies `function:<identifier>` explicitly. It emits one path-bound candidate
per exact match and never selects or approves one automatically.

Markdown heading candidate discovery follows the same read-only boundary. An
explicit `heading:<text>` query searches only bounded allowed `.md` and
`.markdown` paths, verifies each match with the existing CommonMark-backed exact
selector, and emits one path-bound candidate per eligible file. Empty queries,
duplicate headings, fenced pseudo-headings, unsupported files and oversized
sections return no selector candidate. Listing never chooses or approves a
candidate automatically.

Local Markdown-link discovery is also explicit and read-only. A `link:<label>`
query searches the bounded allowed Markdown source set, matches the rendered
CommonMark link label exactly and resolves a relative destination against its
source document. Both source and target must be direct stable regular files;
the normalized target must remain inside the workspace and task allowed paths.
Repeated links to one target deduplicate, while distinct eligible targets stay
separate choices. External, absolute, escaping, query/fragment, fenced and
symlink-backed destinations return no candidate. Approval is still manual, and
link lookup does not recursively crawl documents or infer a label from prose.

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

Every strict child also receives one runtime-owned API/provider/model/context-
window identity captured from the host (or, for isolated tool dispatch, its
fresh trusted worker supplier). SCALER renders explicit `--provider` and
`--model` selectors from that identity and the final provider hook requires an
exact match before transport. Missing, malformed or conflicting identity fails
before runner invocation or execution-side publication; a model-authored spawn
selector cannot choose a different provider/model. The same qualified identity
is included in task-attempt route fingerprints.

The provider gate currently supports only the installed Pi 0.80.3 OpenAI Chat
Completions text/tool shape. Alternate APIs, image/audio and multiple-completion
payloads fail closed. The byte bound can conservatively reject a request that an
exact tokenizer would admit. Conductor, debug retry, stage agents, research,
diagnostic debug, replanning, tool-schema discovery and explicit task spawns now
attach this strict policy after early final-prompt admission. The installed
parent extension separately assesses every ordinary final provider payload
against the live model context window, output reserve and safety margin; it
aborts before transport and records only compact measurements. Provider-internal
retries, model eligibility policy and reconciliation against observed usage
remain later P3 work.

Strict child launches can currently activate only Pi built-in tools and SCALER
tools loaded by the isolated child profile. The shared strict invocation
boundary rejects browser, MCP and other external-extension grants—and malformed
or sparse runtime grant lists—before strict child preparation, attempt/budget
publication or dispatch when that profile cannot load them. This applies to
task, debug-retry, stage and isolated-tool execution/replay as well as the
auxiliary launch paths. A generic non-strict isolated prepare-only record may
retain external tool metadata, but it confers no load or dispatch authority.
SCALER does not claim those tools are available to a strict child; a trusted
external-capability loading adapter remains future work.

## Missing-context lifecycle

Task agents must report missing data instead of guessing. When an accepted `scaler_task_report` uses `status=needs_data`/`blocked` or includes `missingData`, SCALER creates normalized requests under:

```text
.scaler/context/missing-requests.json
```

Each request records status, kind (`memory`, `file`, `local_research`, `internet_research`, `user`, or `tool`), task/report links, query, source hint, PRD refs, evidence refs, and result summaries. `/scaler-missing-context-run` can resolve file/memory requests, dispatch local/internet research requests, or mark user/tool requests blocked for explicit action. `/scaler-missing-context-resolve` records an operator/user answer. Once all missing-context requests for a blocked task are resolved, SCALER moves the task back to `ready`; `/scaler-step` also refreshes research-backed missing-context resolutions before selecting the next task.

An explicit file request is resolved only after its workspace-relative, task-scoped regular file is added to the task manifest as required exact context. A worker can request a bounded existing selector by naming the path first and one separate backtick directive, for example `` `docs/guide.md` `heading:API Contract` `` or `` `src/client.ts` `function:createClient` ``. SCALER persists the path plus selector as required section context and delegates exact extraction, uniqueness, parser, size and freshness checks to the normal context resolver. Malformed, duplicate, missing, ambiguous or oversized selectors remain blocked without publishing the requested item. Without a directive the full-file behavior is unchanged. Symlinked ancestors or files, protected paths, missing/non-regular files and source files over 1 MiB are refused at this boundary. The next task attempt re-resolves the manifest and applies its normal full-prompt admission and freshness checks. A file changing or disappearing before that attempt cannot be treated as satisfied. A request without a known path uses bounded local research; it is not silently mapped to a guessed file. This flow does not infer a path or selector, guarantee that the worker chooses the right request, or automatically decompose a task.

For a path-unknown research request, only a complete report tied to that exact task, question and research request can resolve the missing-data request. Unresolved unknowns or contradictions keep it pending. Its sourced conclusions and source identifiers are saved as required attributed context before the task resumes, with a 16,384-character bound and normal next-prompt admission. The answer is labeled as a research claim; source metadata does not substitute for exact source bytes. The worker can ask for the precise source in a follow-up request. A partial or conflicting report does not silently unblock the task.

Manual answers follow the same delivery rule: a non-file request is resolved only after a bounded, attributed operator answer is saved as required task context. A blank, oversized or conflicting answer cannot unblock it. An explicit file request must use scoped file dispatch; an operator summary cannot stand in for its exact bytes. Neither route proves an answer true. The next attempt still uses normal prompt admission.

## Compression and exact preservation

SCALER uses deterministic compression policy helpers for task-agent prompts:

- Active context target defaults to 75% of the task token budget.
- Context is classified by exactness:
  - `exact`: preserve unchanged; do not paraphrase code, commands, identifiers, API signatures, contracts, requirements, or validation evidence.
  - `summary-ok`: may be compressed into task-relevant conclusions with evidence refs.
  - `reference-only`: keep ids/paths/refs unless retrieval is explicitly needed.
- Large exact or summary-ok items are deterministically externalized to `.scaler/memory/` when a context split is recorded, preserving full content with a memory id/path, SHA-256, token estimates, and exactness metadata. Eligibility uses the larger of a valid caller estimate and the measured content-byte estimate, so an understated estimate cannot hide large inline content.
- Aggregate active-context usage is the greater of a valid supplied total and the sum of measured/conservative per-item estimates. Multiple understated inline items therefore cannot suppress the 75% target, durable split estimate, overage or conductor budget accounting. A more conservative supplied aggregate remains authoritative.
- If resolved active context exceeds the 75% target, conductor preparation/execution records `.scaler/context/splits.json` artifacts for these oversized contexts with exact refs, summary/reference refs, externalized memory refs, and minimal-context handoff recommendations. Executed conductor and debug-retry paths may also record a split when the complete attempt-bearing prompt exceeds a valid allowance while context-only usage remains below target, but only when measured content provides an eligible externalization candidate. Split records identify the active-context or final-prompt trigger and retain the measured prompt overage.
- During normal conductor or debug next-approach retry execution, a just-created split may replace oversized bytes with compact `.scaler/memory/` references only after task/item identity, memory-ledger metadata and stored bytes are revalidated. Debug retries include their required next-approach item in the split basis. The complete attempt-bearing projected prompt must be smaller and within the declared allowance, `read` must be loaded, and the original plus externalized sources remain freshness-bound through result acceptance. Wrapper-only overflow and projections that do not shrink still refuse before dispatch. These memory paths are explicit read-only context exceptions and never extend write/edit scope.
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

`/scaler-context-candidates` lists scored memory/file/PRD/manifest candidates without changing the manifest or active context. An exact `function:<identifier>` query switches to bounded JavaScript/TypeScript selector discovery; `heading:<text>` does the same for exact Markdown ATX headings; `link:<label>` resolves exact local Markdown links; and `import:<specifier>` resolves parser-backed static JavaScript/TypeScript imports or re-exports to extension-explicit local source targets. `import-function:<specifier>#<identifier>` further requires an exact static named binding and one direct exported top-level callable in that target, then returns a path-and-selector-bound section candidate. `import-caller:<specifier>#<identifier>` follows the same verified target edge back to value-level named imports and returns only top-level function/callable-variable selectors containing a direct call through the exact local binding. `reexport-caller:<barrelSpecifier>#<identifier>` permits exactly one additional local named re-export hop: the caller import, stable barrel export and stable final direct callable must all match exactly before the same caller selector is offered. Nested or shadowed calls and property, optional, constructed or tagged uses do not establish an edge. All search only allowed task paths. Package/alias resolution, inferred extensions, dynamic imports, `require`, default/namespace bindings, export-star or recursive barrels and semantic call graphs do not confer file authority. Malformed queries and ineligible sections, declarations or destinations return no candidate; distinct same-named matches remain separate choices.

`/scaler-context-approve` adds the selected candidate to the task manifest unless an equivalent memory/file/content item is already present.

`/scaler-context-splits` lists oversized context records and their externalized memory refs.

`/scaler-compact` requests Pi compaction with SCALER-aware preservation instructions. The `session_before_compact` hook writes deterministic compaction records to `.scaler/context/compactions.json`.

`/scaler-compactions` lists recent compaction records and summary artifact paths.

`/scaler-context-handoff` prepares a fresh minimal-context continuation from a
split record only after revalidating the split, current manifest, every selected
minimal item, and each externalized source's stored identity and bytes. The
legacy `execute` argument now fails closed before invoking a runner because this
route does not yet have conductor-equivalent attempt, provider and result
admission. Normal conductor execution performs its own automatic, admitted
projection for a valid just-created split; it does not call this legacy runner.

`/scaler-context-handoffs` lists fresh handoff records.
