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

## Implementation and validation

Five negative cases failed before correction; three controls passed. All eight
now pass. Candidate identity includes flagged physical files and separately
hashed index metadata, excluding .scaler runtime paths. Only flagged/changed/
untracked files are streamed; normal tracked contents still use Git identity.
The existing 4 MiB binary streaming test retains its byte-hash assertion and adds
the fixture's known staged blob entry to the expected candidate identity.

Gate: build, 649/649 unit, 67/67 mock integration, 5/5 conformance and clean diff.
Final-head Copilot review remains required before merge. Skip/non-Git completion
freshness and final requirement/integration proof remain open.
