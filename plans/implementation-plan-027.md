# Implementation Plan 027 — Automatic Context Relevance Discovery

## Goal
Advance GAP-002 by making default task context manifests discover and rank relevant context from project/runtime evidence instead of only using static supervisor refs.

## Scope
- Add deterministic context discovery for task manifests from:
  - changed git files and allowed task paths,
  - current execution plan task entries,
  - runtime PRD coverage linked to task requirements,
  - recent validation runs for the task,
  - memory index entries matched against task/query terms.
- Integrate discovery into manifest creation used by `/scaler-step` and `/scaler-context-init`.
- Add focused tests for discovery/ranking and docs/traceability updates.

## Out of Scope
- Semantic embedding/vector search.
- UI manifest editing.
- Automatic context refresh for already-existing manifests.
- Broad source crawling beyond current git/runtime ledgers.

## Atomic Tasks
1. **IMPL-113 — Add context discovery helper**
   - Implement async discovered manifest creation in `src/context.ts`.
   - Add tests for changed files, plan, PRD coverage, validation history, and ranked memory.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-114 — Wire discovery into commands/conductor**
   - Make `ensureTaskContextManifest` and `/scaler-context-init` use discovered manifests while preserving existing manifests.
   - Add command/conductor regression tests if needed.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-115 — Document context discovery**
   - Update manuals, inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
