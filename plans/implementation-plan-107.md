# PLAN-107 — P2.3 verify accepted committed outputs at completion

Dependency: PLAN-106 / PR #10. Work may proceed on its branch, but merge only
after the dependency's reviewed head is on main. Preserve review/test gates.

## Bounded acceptance contract

Completion provenance alone cannot prove that a previously accepted Git output
still exists unchanged. Reuse the linked CommitReportRecord: resolve the actual
commit, require it to remain in HEAD ancestry, verify its reported included paths
against the commit's real changed paths, and compare those outputs with the
current working tree. Refuse changed/deleted/recreated outputs, invalid records,
and a rollback that drops the accepted commit. Do not require identical historical
HEADs; independent later task commits remain valid if prior outputs are unchanged.

Use literal Git pathspecs, not shell interpolation or a caller command. Verify
the full immutable commit hash after resolving legacy short hashes. Check deleted
paths explicitly because Git diff does not see an untracked recreation. No new
ledger or invented signatures. This is integrity relative to the accepted commit,
not authentication against an arbitrary writer of all supervisor files.

## Ordered implementation

1. Commit plan, then reproduce false completed=true after unstaged/staged edits,
   external commits, deletion, executable-bit changes, missing commit, rollback,
   and recreation of a previously accepted deletion.
2. Integrate read-only Git output verification into the shared completion guard
   only for matching commit records. Do not silently fall back to an older commit
   or skip after a matching commit fails verification.
3. Preserve real two-task sequential commits and restart; require refusal to
   leave the execution stage unchanged. Keep prior receipt freshness gates.
4. Run build, full unit/mock integration, conformance; separate code and docs
   commits; request final-head Copilot review and merge in dependency order.

## Explicit remaining scope

Skip/non-Git artifact identity, unrelated new outputs, semantic sufficiency of
validation, affected-task revalidation, and final integration/current-requirement
acceptance remain separate work. Overlapping later edits to an earlier task's
outputs require new validation of that task, rather than treating the later task
label as proof of earlier requirements. No full P2.3/SC-10/26 claim, deployment,
paid provider, background service or new framework.

## Implementation and validation

Nine baseline mutation cases failed while both unchanged controls passed.
Follow-up probes reproduced two more bypasses in a Git-diff-only implementation:
assume-unchanged and skip-worktree hid changed working files. The final verifier
reads actual file bytes/modes/symlink targets and compares Git blob identities,
checks the index separately, and verifies committed deletions remain absent.
It does not run external diff/textconv filters or follow symlink ancestors.
An index-only change with the working file restored is also rejected.

The verifier reuses existing commit records, verifies actual path lists and
ancestry, and refuses unsupported submodule outputs. Raw content comparison may
refuse workspaces relying on checkout/clean transformations (e.g. CRLF/filter
conversion); it does not run arbitrary filters to manufacture equivalence.
Such output providers need explicit normalization contracts in later work.

Gate passed: build, 629/629 unit, 67/67 mock integration, 5/5 conformance.
Includes unchanged file/deletion completion and restart, plus PLAN-106's actual
two-task commits. Final-head review remains required before merge.
