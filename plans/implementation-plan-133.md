# PLAN-133 — Durable failed-stage artifact admission

## Reproduced gap

PR #24 now rejects a failed child within its current stage-conductor/workflow
invocation. That process outcome is not bound to the persisted stage artifact.
A child can write a ready replanning artifact directly before returning a
zero-exit terminal `aborted` or `error` event. The first call refuses correctly;
a fresh call sees only a ready artifact and advances to execution without
running another child.

Baseline: PR #24 head `c63910f09422bb485a9fd29ee74bce92fb0df78a`, tree
`42396e6bd1db176718b9058bcfb16140bf3d53fe`.
The local, model-free reproduction has four failures: conductor/workflow
crossed with terminal aborted/error. Two positive controls preserve pre-existing
ready artifacts without a failed child writer. These tests exercise production
filesystem ledgers and entrypoints with injected child outcomes; they do not
demonstrate live model behavior or quality.

## Bounded next unit

1. Make a failed child's persisted stage-artifact proposal remain ineligible
   across a fresh invocation, using the existing stage run, artifact and
   advancement boundaries. Select the smallest compatible durable representation
   after reviewing all stage artifact publishers and readers.
2. Bind the decision to artifact identity/content and the relevant execution.
   A timestamp, a ready flag, or a child-supplied success field cannot provide
   acceptance authority. Do not solve this with blanket deletion or rollback of
   workspace files or unrelated artifacts.
3. Preserve pre-existing legitimate ready artifacts, prepare mode, successful
   child report ingestion and a clearly defined recovery path. A successful new
   run or explicit authorized correction must be distinguishable from replaying
   the same failed proposal.
4. Cover conductor, autonomous workflow and direct advancement readers. Review
   runner exceptions, partial publication, changed artifact IDs, replacement
   content, and missing/malformed durable evidence before declaring closure.
5. Record the remaining process-crash and direct-filesystem trust boundary
   explicitly; observed abort/error handling alone is not crash containment.

## Commit and validation sequence

- Persist this plan and the separate failing regression commit first.
- Implement the durable admission boundary in separate logical commits.
- Add successful retry/recovery and adversarial identity/publication tests.
- Update stage documentation and requirements coverage without promoting any
  broad requirement to complete from these tests alone.
- Run focused stage-agent/conductor/workflow/advancement checks, TypeScript
  build, full unit/component, mock integration and conformance gates on the
  final candidate. Perform own review and request actual Copilot coverage.

## Pipeline and current status

Preparation only on `implementation/v2-p3-stage-artifact-outcomes`, based on
the current PR #24 candidate; no second PR. Production fix is not implemented.
The four deliberately failing regressions are evidence, not an accepted gate.
Do not merge this branch before its prerequisite or while tests remain red.
Before merging PR #24, explicitly account for this residual scope in the review
and handoff; do not claim that its per-invocation fix closes durable artifact
acceptance. Integrate this unit into the coherent phase scope if review requires
closure there rather than deferring it.

No model calls, new provider adapter, general filesystem transaction engine,
automatic planning/decomposition, quality, savings or scale claims are in scope.
