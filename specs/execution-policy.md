# Workspace Sequencing Policy
Requirements: SC-22. Acceptance: AC-22.

## Current baseline

Only one active execution operation is permitted in a mutable project workspace.
This includes task agents, read-only research/tool agents, validation and commits.
Report ingestion and supervisor accounting for that operation are part of the
same ownership boundary, not permission to start a second executor.

Queued tasks and an explicit dependency graph are allowed. Multiple agents can
execute sequentially with separate focused contexts. No parallelism is necessary
to demonstrate context isolation or core product acceptance.

## Ownership and recovery

Enforce exclusive operation ownership consistently at all entry points.
Attempts cannot recursively start another executor while retaining a conflicting
workspace operation; delegation must hand off/schedule through the owner.
A status read or preparation preview does not claim that execution began.

After interruption, verify the prior owner/process/effect status before release
or reassignment. A timeout or stale timestamp alone is not proof that work stopped.

## Future extension

Snapshot-based read-only fan-out or isolated worktree execution MAY be proposed
later, but is outside this baseline. It needs an explicit opt-in policy, consistent
snapshot identities, disjoint effect scopes, bounded resources and integration
validation. Old parallel-tool language does not authorize it now.
