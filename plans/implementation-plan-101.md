# PLAN-101 — P2.2 attempt identity and interrupted execution

Implement the next bounded PLAN-099 unit after the tool-ledger prerequisite. This
unit establishes durable task-attempt identity and version binding; it does not
claim shared acceptance authority (P2.3) or exactly-once external effects (P6).

## Observed gaps

- A task is persisted as `running` before the runner call, but no durable attempt
  identity records what was admitted. After process loss it remains apparently
  live, with no safe distinction between not launched and uncertain effects.
- `TaskAgentReportRecord.runId` is optional and currently means a caller-supplied
  label. Reports are checked against task id, not a unique admitted attempt.
- Task-agent runs and validation handoffs do not retain task/input/route/policy
  versions. Validation can therefore consume evidence after relevant inputs or
  its manifest changed.
- `conductor`, `debug-retry`, the `scaler_task_report` tool and direct validation
  are separate entry points. P2.2 supplies identities to them; P2.3 will make one
  acceptance guard authoritative across all routes.

## Bounded implementation sequence

1. Add one canonical SHA-256 helper for JSON-compatible contract material. Reject
   unsupported/non-finite/cyclic input instead of producing an unstable identity.
2. Define a durable task-attempt record with a UUID, run/task identity, task
   contract fingerprint, admitted input fingerprint, selected model/tool route
   fingerprint, validation-policy fingerprint, lifecycle outcome and timestamps.
   Persist the admission before launch using complete same-directory replacement.
   The execution lock remains the single writer boundary for attempt lifecycle.
3. Store the active attempt id on the task snapshot before dispatch. Include the
   attempt id and admitted fingerprints in the child prompt/report contract.
   Compute the output fingerprint in supervisor code from normalized report
   material; never trust a worker-supplied digest as proof.
4. Require conductor/debug-retry result ingestion to match the current run, task
   and attempt. Reject delayed/replaced-attempt output without advancing task
   state or duplicating usage/evidence. Preserve read compatibility for historical
   records, but never reinterpret a legacy unbound report as current evidence.
5. Reconcile an admitted/dispatching attempt left by interruption to an explicit
   interrupted/unknown outcome and a blocked task before new scheduling. Do not
   clear it, synthesize success or rerun the worker/tool. A launch failure is
   recorded separately from an uncertain post-dispatch outcome.
6. Carry attempt and input/output/policy fingerprints into run and handoff records.
   Validation must refuse a changed current task/input/policy identity. P2.3 will
   subsequently consolidate manual commands, hooks and report tools under the
   same acceptance decision rather than duplicating these checks.

## Regression boundary

- A preview creates no attempt and does not mark a task running.
- Two retries receive different attempt ids even for an unchanged task contract.
- A delayed report from attempt A is rejected after attempt B is current; accepted
  progress, usage and report counts do not change twice.
- Changing task contract, resolved input content, selected route or validation
  policy changes only the corresponding fingerprint and invalidates stale output.
- Inject interruption before launch and at the dispatch boundary. Recovery records
  an explicit outcome, blocks automatic replay and leaves a diagnosable handoff.
- Existing version-1 state/report files load without fabricating attempt evidence.
- Build, focused unit tests and the full unit/mock gate must pass. Synthetic
  runners only; no paid model, provider mutation or deployment is authorized.

## Explicit non-goals

No multi-file transaction claim, arbitrary provider effect reconciliation,
automatic orphan-lock deletion, task decomposition redesign, context-routing
optimization, database/service introduction or full SC-01/02/10/13/26 compliance.
Green tests establish only the named attempt and stale-delivery behaviors.
