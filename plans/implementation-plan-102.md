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

## Implementation boundary

`src/validation-acceptance.ts` owns the shared snapshot/receipt verifier;
`runTaskValidation` records receipts and rejects snapshot drift across commands.
Both `commitValidatedTask` and `skipTaskCommit` use the verifier before Git staging,
committing or accepted-skip publication. Locked wrappers inherit the same guard.
The existing unrelated-path safety refusal remains intact and runs first.

The Git snapshot binds HEAD and changed/untracked non-ignored candidate paths,
including bytes, deletion, executable bit and symlink targets (not target contents).
The current project's `.scaler` subtree is runtime metadata, not candidate output,
including when the project is nested in a Git worktree. Ignored artifacts and
non-Git output versions are not covered. Unsupported changed file types fail
closed; there is no arbitrary submodule/directory-content acceptance claim.

Validation receipts also bind command results. Required commands need matching
passing results or declared skips with reasons. The latest record without a
receipt is historical only: rerun validation instead of upgrading its status.
State must be persisted and current before commit/skip. Fresh manual command
validation can produce a receipt without inventing a worker attempt.

Tests reproduced ten failures on the preceding implementation before the fix.
Added scenarios cover four commit/skip entry points, changed task/policy/run/attempt,
legacy/tampered evidence, label-only acceptance, positive commit/skip, changes
during checks, binary/untracked/deleted/mode/symlink changes and nested metadata.
Existing commit fixtures now execute checks rather than fabricate proof via a
`validated` label; all original safety/audit assertions are retained. The CI wrapper
fixture writes its test marker under its documented runtime artifact directory
and additionally asserts a passing validation result.

The read-only verifier is not a filesystem transaction, a signature, or protection
against a writer allowed to replace ledgers. External edits after the final check,
manual report/checklist acceptance, direct hooks, integration semantics and
non-Git evidence remain follow-up P2.3/P6 work. Do not infer universal acceptance
from this first bounded slice.

Validation before review: TypeScript build passed; 29/29 focused acceptance/Git/
operation tests, 560/560 full unit tests and 67/67 mock integrations passed.
`git diff --check` is clean. Synthetic/local checks only, no live provider calls.
Copilot review and current-head checks are required before merge. The next bounded
P2.3 step is shared authority for manual reports/checklists and automatic acceptance,
not extending receipt hashes into a second orchestrator.
