# PLAN-159 — Required memory candidate context before resume

## Requirement and reproduced gap

SC-07 requires a focused worker to receive requested task-authorized information
before the supervisor resumes it. The current memory missing-context dispatcher
marks a request resolved when search returns candidates, but records only their
identifiers on the request. Their bounded summaries are absent from the task
context manifest, so the task can resume without the information it requested.

## Minimal change

Before resolving a memory request, add the bounded search results to that task's
manifest as required `memory` items with `summary` scope. Preserve each durable
memory identity and expose its validity/source metadata through the existing
memory resolver. Refuse a conflicting manifest identity. Serialize the manifest
read/merge/save and request resolution for that task so concurrent requests do
not lose already accepted context. Save the manifest once, then resolve the
request; do not add a new retrieval, ranking or approval layer.

Search results remain candidates, not established facts. The worker may request
more exact material or investigation on a later turn. Existing prompt admission
continues to enforce the configured envelope.

## Validation and limits

Add a failing regression proving the current false resolution, then verify that
the resumed task prompt contains the bounded candidate summary and excludes the
memory's full body. Also cover conflicting manifest identity and no-candidate
blocking. Run focused missing-context/autopilot checks, build and the applicable
candidate gate once.

This unit does not establish memory freshness semantics, automatic semantic
selection, arbitrary-model quality, token savings or full SC-07/AC-07 coverage.

## Outcome

The memory dispatcher now promotes matched entries to required bounded summary
context and validates their availability and aggregate size before persisting
the manifest and resolving the request. The resumed task prompt receives the
summary plus source/validity metadata and not the full memory body. No-match and
conflicting-scope regressions remain blocked without manifest mutation. A
bounded per-task lock preserves both required items when two memory requests
resolve concurrently.

Final accumulated phase validation: TypeScript build, 1,177/1,177
unit/component, 72/72 mock integration, 10/10 conformance/autopilot, 18/18
focused missing-context/autopilot checks and `git diff --check`.
