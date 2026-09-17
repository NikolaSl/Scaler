# PLAN-109 — bind validation candidates hidden by Git index flags

Dependency: PLAN-108 / PR #12. Same authorization and 21:00 Europe/Sofia cutoff.

PLAN-107 proved that Git diff/status can hide real changes behind assume-unchanged
and skip-worktree. The current precommit candidate snapshot still derives its
physical file list only from Git diff plus untracked files. Reproduce the same
blind spot on direct receipt/commit-skip acceptance, with the index flag set
before validation and a hidden edit afterward. Also test an index-only edit
whose working file is restored to its accepted bytes.

1. Commit this plan, add negative fixtures for both hidden flags and index-only
   drift, and preserve an unchanged flagged-file positive control.
2. Extend the existing candidate snapshot: include physical contents of flagged
   tracked paths, and bind index entries separately from working-tree bytes.
   Read index metadata, not every tracked file's contents. Preserve runtime
   exclusions and existing streaming hashes/symlink guards. No new ledger.
3. All callers of current-receipt verification inherit the check. Existing
   receipts lacking this identity fail closed/revalidate, not silent migration.
4. Build, unit/mock integration and conformance; separate code/docs commits,
   Copilot review, expected-head merge in dependency order.

This fixes concrete Git candidate identity omissions, not universal filesystem
containment, non-Git output identities, semantic checks, or final integration.
No provider/model spending, additional agents, or speculative architecture.
