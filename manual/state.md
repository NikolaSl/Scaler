# State

Scaler stores deterministic supervisor state in:

```text
.scaler/state.json
```

The state file is created by `/scaler-status` if it does not exist.

Current state fields include:

- run id
- state revision (separate from the file format version)
- orchestration complexity level
- current stage
- previous stage when paused
- current task id
- task states
- completed and validated task ids
- blockers and memory references
- rejected transitions
- budget placeholder
- timestamps

The supervisor is algorithmic code. It validates stage/task transitions and records rejected transitions instead of trusting free-form LLM claims.

## Publication and conflicts

All application writes to `state.json` go through `saveState`. A short filesystem
lock serializes the read/compare/publish operation across processes. A proposal
must carry the same `runId` and `revision` as the stored state. A successful save
increments the revision and updates the supplied object's persistence metadata;
derived snapshots must retain that revision before another write. Revision zero
means a state has never been saved and permits initialization only.

`StateConflictError` means the proposal is stale, the run changed, or its stored
state was deleted. The caller must reload and reassess the intended action; do
not simply copy the new revision onto an old proposal or replay external work.
Readers see complete snapshots through same-directory atomic publication.

Existing version-1 files without a revision are read as logical revision one
without rewriting their bytes. The next accepted write persists revision two.
This does not add validation evidence or certify legacy accepted task labels.

The publication lock is `.scaler/state.json.lock/`, separate from the long-lived
execution lock. Contention waits for up to two seconds, then fails with
`StateWriteBusyError`; the lock is never stolen because of age. If a writer
crashes, stop all processes that can write this workspace, inspect the durable
state and unfinished actions, then remove only this publication lock directory
before restarting. An orphan `state.json.<uuid>.tmp` file is an unpublished
snapshot, not an instruction to resume or replay an action. Reads continue to
work while the publication lock is held.

This boundary protects cooperating state writers on the same filesystem. It is
not a transaction over report/validation/tool ledgers, a worker-authority barrier,
or power-loss durability. Attempt reconciliation and version-bound evidence
acceptance remain separate migration work in PLAN-099.

## Tool execution indexes

`requests.json`, `results.json` and `transactions.json` under
`.scaler/tool-requests/` use complete same-directory snapshot replacement.
Cooperating writers serialize each read/modify/write operation using
`execution-ledger.lock/` in that directory. This protects parallel requests,
results and transactions from lost updates within and across processes. Readers
do not acquire the lock and cannot observe an in-progress JSON write.

Cross-process lock contention waits at most two seconds before failing. A lock
is never stolen based on age. The in-process queue is released even when lock
acquisition or publication fails. Lock removal is retried briefly. If removal
still fails after a successful publication, the operation remains successful to
avoid unsafe tool replay and the process emits
`SCALER_TOOL_LEDGER_LOCK_RELEASE_FAILED`; later writers fail closed until manual
reconciliation. The lock is not held across tool/model work.
After a crashed writer, stop all workspace writers, reconcile unfinished work,
then remove only its orphaned publication lock. An orphan `*.json.<uuid>.tmp`
is unpublished data; do not promote it or replay tool effects automatically.

This is **not** a transaction across the three indexes: an interrupted result
write can leave the request status ahead of its result record. A failed call is
not proof that no index changed or no tool effect occurred. These indexes are
not acceptance authority, and this repair adds no exactly-once or power-loss
guarantee. Schema, scheduling, iteration and replay-approval catalogs are outside
this publication boundary. See PLAN-100 for regression evidence and limits.
