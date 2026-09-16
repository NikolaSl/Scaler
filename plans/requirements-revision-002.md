# Requirements Revision 002

## Goal and boundary

Refine requirements for economical autonomous orchestration before architecture
and code changes. Base: d866b6957d0b79b455875e56b635ff8f774d0129.
User authorized requirements cleanup, optional environment providers and
three-mode tool/MCP execution. Existing sequential workspace policy is retained.

## Planned work

- [x] Read assignment, catalog, specifications and earlier review evidence.
- [x] Separate mandatory guarantees from optional mechanisms and implementation choices.
- [x] Rewrite assignment/catalog and align all behavioral specifications.
- [x] Add local-model, effect-recovery, scale/evaluation and execution-policy details.
- [x] Add one acceptance scenario and current coverage row per stable SC-* requirement.
- [x] Map every historical PRD-* ID and label old closure claims as historical.
- [x] Check document structure, links, coverage and change scope.
- [ ] Architecture and implementation migration: deliberately deferred to next phase.

## Validation

Document integrity: catalog/scenarios/coverage sets must match, legacy requirement
IDs must all be mapped, relative Markdown links and referenced anchors must resolve,
all behavioral specs must be indexed, and only Markdown files may change.
Run git diff --check and the existing focused conformance tests for historical
compatibility. No model-call savings or revision 2 runtime compliance is claimed.

## Results — first iteration, commit db65b75

These results describe the first requirements iteration at `db65b75`, not the
final merged PR. The second iteration at `a84f532` added one document, bringing
the complete PR to 39 Markdown files; its results are recorded in
`plans/requirements-revision-002-iteration-02.md`.

- Document integrity passed: 27 SC requirements, 27 AC scenarios and 27 coverage rows.
- All 49 historical PRD IDs are mapped; all 24 spec documents are indexed.
- Relative Markdown links and referenced anchors in changed files resolve.
- This first iteration changed 38 Markdown files; no runtime source, dependency or test code changes.
- git diff --check passed.
- Existing focused conformance tests: 5/5 passed; legacy compatibility only.
- No real-model or whole-runtime re-test was performed for this documentation change.
