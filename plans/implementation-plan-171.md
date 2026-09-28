# PLAN-171 — Reopen only explicitly affected tasks on replan acceptance

## Reproduced gap

PLAN-170 marks an existing requirement coverage row `needs_replan` after a
material user-authorized amendment. Validation receipts also reject the old
requirement revision. However, accepting a preservation-valid replan leaves the
linked task terminally `validated`, so the accepted plan cannot resume that task
while an unrelated validated task must remain untouched.

Baseline: PLAN-170 exact tree
`dbdfb0bd08c6539f383799de7c2d2d13a3847172`.

## Minimal unit

1. At replan acceptance, derive affected requirement IDs only from current
   coverage rows explicitly marked `needs_replan`.
2. Reopen only validated tasks linked to those requirements through task
   `prdRefs` or the coverage row's retained `taskIds`; remove only those task IDs
   from current validated/completed sets. Preserve unrelated validated tasks.
3. Require the proposed plan to retain the affected task ID under the existing
   preservation gate. Reopen that preserved contract without letting a model
   rewrite accepted metadata, set the affected coverage row to `in_progress`,
   and retain historical evidence/notes.
4. Record reopened task IDs in the replan decision. Keep the existing plan,
   coverage, task-quality, dependency and acceptance-policy gates.
5. Do not infer semantic impact beyond explicit links, automatically replace or
   retire task IDs, add an `obsolete` task status, or claim complete AC-12/27.

## Test and commit sequence

- Commit this bounded plan first.
- Add a failing acceptance regression with one changed linked task and one
  unrelated validated task.
- Implement the smallest acceptance-time state/coverage update using existing
  locks and task update gates.
- Run focused plan/stage/PRD checks, build and the applicable exact-head gate;
  keep SC-12 and SC-27 Partial.

This unit makes a preservation-valid replan executable without restarting
unaffected work. Replacement/obsolescence and semantic affected-slice discovery
remain later bounded units.

## Outcome

Implemented on `implementation/v2-p4-requirement-invalidation`. Replan
acceptance derives invalidated requirements from current `needs_replan` coverage,
reopens only their explicitly linked validated tasks, retains unrelated validated
tasks and preserves accepted task contracts. Affected coverage advances to
`in_progress` with evidence and notes retained; decisions record reopened task
ids. Exact-head review exposed two interruption/concurrency gaps: a partial
acceptance could lose its reopened-task audit on retry, and a stale whole-file
coverage write could erase an unrelated invalidation. The existing decision
ledger now journals `applying` before core mutations and resumes that exact
proposal idempotently; the PRD lock rereads and merges only the journaled
requirements when their captured revisions still match. The candidate passes
build, 1,223 unit/component, 73 mock integration, 10 conformance/autopilot and
52 focused plan/PRD checks. SC-12 and SC-27 remain Partial for the deliberately
excluded trigger, replacement/obsolescence and semantic impact boundaries.

A final independent recovery review found that an `applying` retry could still
erase a newer same-revision invalidation of the same coverage row, while a
requirement revision mismatch was detected only after downstream durable
effects. The journal now also captures each affected coverage row's update
timestamp. Under the PRD lock, acceptance first verifies that exact invalidation
or its own already-completed transition, then advances coverage before publishing
the plan, reopened state or task effects. A newer coverage update or requirement
revision fails closed without those downstream mutations.
