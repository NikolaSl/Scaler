# Git Project History
Requirements: SC-18. Acceptance: AC-18.
Applies to the default Git project profile; explicit non-Git runs record why.

## History contract

Preserve project outputs plus compact task/plan/requirement decisions and validation
references in Git at accepted work boundaries. History MUST map each accepted task
version to its output commit/artifact identity and evidence manifest.
Raw transcripts, caches, credentials and large artifacts are excluded by default.

Evidence manifests MUST declare referenced artifact hashes, storage/retention
locations and whether a Git clone alone is sufficient to reproduce or audit them.
Git provides version history, not automatic backup of external artifacts.
Required evidence must remain available under the run's retention policy.

## Commit acceptance

Validate the exact intended output snapshot. Stage only owned task changes,
account for pre-existing staged/untracked/user changes, and reject unintended
index contents. If outputs change after validation, revalidate affected outputs
before commit acceptance. Use full commit identities in durable records.

Record intent before committing and outcome after. If a crash follows commit
creation, reconcile the existing commit rather than duplicating work.
History recording and accepted-state recording must be recoverably linked; a
second metadata-only event/commit may record the resulting output commit hash.

A task with no changes records a justified no-change outcome. A non-Git profile
records an explicit skip/alternative history mechanism. Skipping Git does not
waive output validation.

## User scope

Do not reset, stash, overwrite or include unrelated changes silently. Prefer safe
isolation or pause if ownership cannot be established.
Local commit, remote push, PR creation, publication and history rewriting are
distinct actions governed by existing authorization.
One logical task per output commit is the default, with documented exceptions for
a coherent validated delivery boundary.
