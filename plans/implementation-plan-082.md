# Implementation Plan 082 — GAP-017 Memory Search and Summary Retrieval

## Goal
Close GAP-017 by making external memory discoverable without exact ids and by preventing summary-scoped task prompts from loading full memory files.

## Scope
- Add optional tags to memory index entries and memory writes.
- Add deterministic memory search by query, tag, task id, and validity with concise summary/reference formatting.
- Add `/scaler-memory-search` and `scaler_memory_search` for candidate discovery.
- Respect memory manifest scope: summary/reference-only injects memory references; full scope retrieves full content; section scopes retrieve matching Markdown sections when possible.
- Add unit, mocked integration, and targeted real Pi command coverage.
- Update manuals, inventory, traceability, and gap backlog.

## Non-goals
- No vector/RAG backend.
- No automatic broad memory injection from search results.
- No semantic embedding ranking.

## Validation
- Targeted memory/context/tool/command tests.
- Targeted mocked integration for memory search and summary prompt context.
- Targeted real Pi `/scaler-memory-search` command test.
- `npm test`
- `npm run build`

## Commits
1. `PLAN-082: add memory search plan`
2. `IMPL-320: add memory search workflow`
3. `IMPL-321: cover memory search workflow`
4. `IMPL-322: document memory search coverage`
