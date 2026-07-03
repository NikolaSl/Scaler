# Implementation Plan 032 — Compression and Exact-Preservation Workflow

## Goal
Advance GAP-006 by adding deterministic context compression policy support, exactness metadata for context manifests/items, and task-agent prompt guidance for exact-preservation, externalization, and split recommendations.

## Scope
- Add context `exactness` metadata (`exact`, `summary-ok`, `reference-only`) to resolved context items and task context manifests.
- Add deterministic compression assessment helpers that classify exact references, summary candidates, reference-only candidates, over-budget state, and split/externalize recommendations.
- Add compression guidance to task-agent prompts so agents preserve exact data unchanged, summarize only summary-ok context, and externalize large/exact content by reference.
- Update manuals, inventory, traceability, and gap backlog.

## Out of Scope
- Automatic LLM summarization/compression of arbitrary text.
- Storage compression/rotation and hard disk limits; that remains under GAP-011 / PRD-S17.
- Semantic context search/UI editing.

## Atomic Tasks
1. **IMPL-128 — Add compression policy primitives**
   - Implement compression assessment/guidance helpers and tests.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-129 — Integrate exactness metadata into context prompts**
   - Extend context manifest/item exactness fields, default/discovered exactness, validation/formatting, and task-agent prompt guidance.
   - Add/update tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-130 — Document compression and exact-preservation workflow**
   - Update manuals, implementation inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
