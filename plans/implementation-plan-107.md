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
