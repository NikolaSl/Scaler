# Implementation Plan 092: Git bootstrap and commit/skip validation acceptance ordering

## Gap
GAP-030: repository bootstrap, pre-task dirty-tree handling, and the supervisor rule that tasks become validated only after commit or explicit skip evidence are incomplete.

## Scope
- IMPL-350: Add git bootstrap/status ledgers, repository initialization, Scaler runtime ignore-rule maintenance, and run-start audit integration.
- IMPL-351: Enforce pre-task dirty-tree checks before conductor starts task work, pausing with checkpoint evidence on unrelated existing changes.
- IMPL-352: Gate validation acceptance on commit/skip evidence, allow commit after passed validation, add explicit commit-skip records/command, and document/test the lifecycle.

## Validation
- Unit tests for bootstrap records, ignore updates, commit-skip records, and validation acceptance gating.
- Mocked integration for dirty pre-task pause, commit-required validation, commit-after-validation transition, and explicit skip transition.
- Opt-in real Pi command coverage for git bootstrap/status or commit skip where practical.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
