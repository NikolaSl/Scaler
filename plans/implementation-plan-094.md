# Implementation Plan 094: Semantic context curation and Pi context hook

## Gap
GAP-032: context discovery uses deterministic lexical scoring/manifests, but semantic/RAG candidate curation, manifest approval/edit commands, and parent-session `context` hook injection/filtering are incomplete.

## Scope
- IMPL-356: Add deterministic semantic-style context candidate discovery over task metadata, memory summaries/tags, allowed files, changed files, PRD refs, and existing manifests with scored reasons and no automatic broad injection.
- IMPL-357: Add context curation commands to list candidates and approve selected candidates into task manifests with compact summary/snippet/reference scopes.
- IMPL-358: Add a Pi `context` hook that injects only approved manifest summaries/snippets/reference items within a small budget, plus unit/extension/real coverage and docs.

## Validation
- Unit tests for candidate scoring, selection, manifest persistence, and hook text budget/filtering.
- Command/extension-shape tests for curation commands and `context` hook behavior.
- Targeted real Pi command/hook coverage where practical.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
