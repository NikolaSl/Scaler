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

### Self-review correction

The rename-vs-copy regression exposed a real collision: rename detection in
`git diff --name-only` omitted the deleted source, so retaining that source could
leave the candidate digest unchanged. Candidate enumeration now uses
`--no-renames`, preserving both deletion and addition. Symlink ancestors are
refused before reading a candidate through them. Neither fix expands tool grants.
Build, 19/19 acceptance regressions, 562/562 unit tests and 67/67 mock integrations
pass after this correction. It is a separate commit requiring current-head review.

### Copilot review fixes

Review 5230550362 raised two valid findings (4032712797 / 4032712816):
snapshot failures escaped commit/skip and both validation snapshot points as
exceptions. Four new regressions reproduced the thrown errors. The receipt
verifier now returns rejection diagnostics; validation records a blocked run,
preserving any commands already executed and leaving task acceptance unchanged.
Low-level snapshot helpers still throw to callers that explicitly request capture;
acceptance/validation boundaries convert those failures to refusal, never success.
Build, 23/23 acceptance regressions, 566/566 unit and 67/67 mock integration tests
passed after the corrections. Re-review on the corrected head is required.

Review 5230606015 confirmed no new inline findings but raised two reasonable
follow-ups in its body: whole-file buffering and an inaccurate optional-field
comment. File digests now use `createReadStream` with incremental hashing rather
than `readFile`; a multi-chunk binary fixture checks byte-identical digests.
The comment now states the actual normalization (absent diagnostics become `[]`,
undefined nested optional fields are dropped). This is not a scale benchmark.
Final corrected gate: build, 24/24 acceptance, 567/567 unit, 67/67 mock integration.

Review 5230641032 raised skip-evidence consistency. Simple post-receipt tampering
was already rejected by the result digest; the reproduced gap required a
self-consistent malformed producer receipt. The verifier now requires the stored
skip disposition and non-empty reason to match the current declared policy, while
retaining (not replacing) policy authorization. Positive reasoned skips still work.
This improves evidence shape checks without claiming authenticated ledgers.
Gate after this correction: build, 26/26 acceptance, 569/569 unit, 67/67 mock tests.
