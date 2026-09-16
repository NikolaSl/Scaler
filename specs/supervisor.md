# Supervisor, Recovery and Lifecycle
Requirements: SC-01, SC-13, SC-26. Acceptance: AC-01, AC-13, AC-26.

## Authority

The supervisor MUST be the sole logical authority for accepted state. All entry
points, including manual commands, agent reports, hooks and resume paths, MUST
use the same admission and completion guards. The implementation may use multiple
processes, but MUST prevent stale writes and unauthorized acceptance.

Agents submit proposals and observations. A report status is not an instruction
to bypass validation. Invalid or unauthorized proposals MUST leave accepted
progress unchanged and produce a rejection reason. Corrections are bounded.

State reads MUST NOT change logical state or its revision. State and evidence
writes MUST be recoverable after interruption; a partially written snapshot MUST
NOT be treated as valid. Duplicate event/report delivery MUST NOT double-apply
progress, usage or effects. Delayed reports MUST be checked against their run,
task version and attempt identity.

## Lifecycle semantics

The implementation may choose state names, but MUST distinguish these meanings:

| Meaning | Required guard |
|---|---|
| Planned | Contract exists; not yet eligible or admitted |
| Ready | Current inputs, dependencies, authority and resources permit execution |
| Prepared | Proposal/context preview exists; no execution has started |
| Running | An attempt has been admitted and its start is recorded |
| Awaiting validation | Output proposal exists for a specified artifact version |
| Accepted | Required evidence and history policy satisfied for that version |
| Blocked/paused | Named unmet condition with a resumable continuation |
| Failed/cancelled | Stopped attempt/run with explicit outcome and cleanup status |
| Obsolete | Previously valid result no longer supports current requirements |

A prepared operation MUST NOT become running. If launch fails, reconcile the
admitted attempt as not started/failed; do not leave an apparently live worker.
Accepted history is retained when current validity changes.

## Recovery

Persist enough identity, revision, input/output references, operation ownership
and log position to reconstruct accepted progress. On restart, reconcile running
attempts, unfinished validation, Git state, external effects and process ownership
before scheduling work. Resume MUST NOT blindly clear a lock, rerun a committed
task or accept an output that changed after validation.
See [effects-recovery.md](effects-recovery.md) for uncertain external outcomes.

## Autonomy and completion

Continue within existing task authority and budgets without confirmation at every
step. Pause only for an unmet requirement, insufficient capability/resources,
unresolved consequential ambiguity, a policy boundary, or a user pause request.
A pause report MUST identify the blocker, preserved work and exact continuation.

Cancellation MUST stop new work, request termination of owned operations,
record remaining live/uncertain operations and retain evidence. A signal being
sent is not proof of process exit. Cancellation is not successful completion.

Run completion MUST check the latest requirements, required tasks, integrated
acceptance, remaining blockers and unresolved effects. An empty task list is not
proof that a nonempty request has been fulfilled. Report quality limitations,
usage and history references without claiming unverified success.
