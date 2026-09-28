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
   preservation gate. Apply its admitted task contract, set the affected
   coverage row to `in_progress`, and retain historical evidence/notes.
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
