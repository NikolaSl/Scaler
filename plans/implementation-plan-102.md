# PLAN-102 — P2.3 shared acceptance, first bounded slice

Dependency: merged PLAN-101 / PR #5 (`06a8456`). Preserve its attempt and
freshness primitives rather than creating another attempt lifecycle.

## Observed acceptance bypass

`commitValidatedTask` and `skipTaskCommit` accept a `validated` label or the most
recent passing validation by task id. Neither proves that the validation belongs
to the current run/attempt/task/policy/output. Both direct functions and their
execution-lock wrappers can therefore finalize stale evidence. Existing tests
also contain hand-constructed validated labels; these are not proof of validation.

## First reviewable unit: version-bound validation receipts

1. Reproduce commit/skip after changing the validated task, policy, attempt or
   worktree, plus a legacy passing record/validated label without fresh evidence.
2. Have supervisor command validation capture a versioned receipt binding run,
   task contract, attempt/report identity where present, policy, declared context
   and the Git candidate output. Check the same snapshot before and after checks.
3. Add one shared read-only receipt verifier for both direct commit and skip,
   including their lock wrappers. Require current passing command evidence, not
   an accepted label; never run Git mutations on rejection.
4. Keep historical validation records readable. Revalidation creates fresh proof;
   do not upgrade old records or weaken existing safety/validation assertions.
5. Test focused acceptance/Git paths, build, full unit/mock integration gate;
   update coverage and request Copilot on the final head before merge.

## Remaining P2.3 work (not claimed by this slice)

- Consolidate manual reports/checklists, command/hook routes and automatic Git
  acceptance under the same supervisor-owned acceptance authority.
- Enforce independent evidence and required integration criteria beyond a worker
  claim or self-asserted checklist. Protect criteria from worker amendment.
- Cover non-Git artifact versions, semantic quality, idempotent acceptance and
  authority against child writes. A receipt digest is not authentication.

No provider spending, deployment, database, new orchestration framework or
universal acceptance claim. New failures are fixed with regressions and separate
commits; incomplete work stays draft and unmerged.
