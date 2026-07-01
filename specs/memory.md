# SCALER External Memory Spec

## Principle

External memory is cheap. Tokens are expensive.

The active context should contain only what is needed for the current step. Details that may be useful later should be stored in files and referenced briefly.

## Location

Store memory files under `.scaler/memory/`.

Keep an index at `.scaler/memory/index.json` or `.scaler/memory/index.md`.

See `specs/storage.md` for compression, retention, and disk safety rules.

## Memory reference

The active context should keep only:

- Memory id.
- Short description.
- File path.
- Related task/stage.
- When it may be useful.

## Memory metadata

Each memory should include:

- id
- title/topic
- source
- related task/stage
- created/updated time
- validity status: `active`, `stale`, `obsolete`, `unknown`
- short summary
- file path

## Retrieval

Memory retrieval follows the context selection rules in `specs/context-selection.md`.

Agents should not load memory files directly into context unless needed.

When needed, the agent creates a structured memory-retrieval request with:

- memory id/path
- reason for retrieval
- expected use
- requested scope: full file or specific section

The agent loop retrieves the memory and injects only the requested useful content before the next iteration.

## Limits

- Retrieve only memories needed for the current task.
- Prefer summaries or specific sections over full files.
- Do not retrieve memories only because they are related in general.
- Mark obsolete memories instead of repeatedly summarizing contradictory data.
