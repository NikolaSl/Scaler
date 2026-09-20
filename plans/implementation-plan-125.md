# PLAN-125 — P3 isolated tool-result acceptance boundary

## Observed acceptance gap

PLAN-124 records non-authorizing route advice. The existing isolated tool-agent
executor still accepts a structured result solely by `requestId`: the child tool
closes the request before the parent observes process completion, and the parent
then treats any matching result as success. A zero-network reproduction records
a `completed` result and then returns `exitCode=1`, `timedOut=true`; the current
workflow reports the request and transaction as completed.

The same boundary is used by normal runs, replay, iteration and schedule. Replay
excludes older result ids but still has no execution identity. Schedule also
dispatches low-risk requests concurrently even though the repository execution
policy requires a sequential workspace. These are prerequisites to binding a
PLAN-124 assessment or strict provider admission at dispatch.

## Bounded unit

1. Create and persist one execution transaction before spawning an isolated
   worker. Pass its runtime-owned id to the child without adding a model-chosen
   authority field.
2. Record `scaler_tool_result` payloads as proposals bound to that exact
   execution. Recording a proposal MUST NOT close the request.
3. After the child exits, the parent accepts exactly one fresh proposal only
   when the execution id and request match, the request is still prepared, and
   the process exited successfully without timeout or abort.
4. A non-zero exit, timeout, abort, missing result, foreign/stale result or
   duplicate proposal MUST NOT produce a completed transaction. Possible-effect
   failures become blocked and are not automatically replayed.
5. Replay uses a new execution identity and accepts only its own result.
   Existing replay approval rules remain in force; this unit does not broaden
   authority or silently modernize a persisted invocation.
6. Iteration inherits the same parent acceptance boundary. Schedule execution
   is sequential regardless of the advisory risk classification; the historical
   `parallelism` input is retained only for compatible planning/audit output.
7. Preserve compact audit evidence for the proposal, execution identity,
   process outcome and final acceptance decision. Legacy result records remain
   readable but cannot satisfy a new execution.

## Test-first evidence

- a completed proposal followed by non-zero exit, timeout or abort is rejected,
  leaves no accepted result and blocks automatic replay;
- a successful process with exactly one result bound to its execution completes;
- a result for another execution, a stale result and two proposals for one
  execution are rejected;
- replay accepts only the newly bound result, never an earlier result for the
  same request;
- iteration stops rather than replaying a possible-effect process failure;
- schedule runner calls never overlap and the second request observes state
  written by the first even when `parallelism` is greater than one;
- prepare-only flows remain side-effect free and legacy ledgers still load.

Run focused tool-request, ledger-concurrency and extension tests, then build,
full unit, mock integration and conformance/autopilot gates. Two independent
GPT-6 Astra/high reviews inspect the exact final head.

## Explicit limits

This unit does not execute `direct` or `current-agent` routes, authorize PLAN-124
advice, attach strict provider-envelope admission, recompute route evidence,
bound child stdout/process memory, or enforce a serialized result byte limit.
Those remain subsequent dispatch prerequisites. A bound structured result also
does not prove that an external side effect did or did not occur; ambiguous
process failure therefore blocks rather than retries.

## Implementation evidence

- `d076ddd1a2be70938617bd67a5ecd54caf2bdf77` preserves the failing baseline for
  false acceptance after failed process outcomes, overlapping schedule runners
  and missing execution identity.
- `2755dc416a374d8d7474896ef4fe8499ecc5de6f` adds runtime-owned execution ids,
  proposal-only child results, parent-side outcome acceptance, sequential
  schedule execution and blocked ambiguous iteration behavior.
- `1ff383afe7a573f60467f1cff5bcd9be2b19aa42` closes adversarial review gaps:
  replay approval is reserved atomically before dispatch, stale finalizers do
  not erase replacement ownership, result APIs return the finalized acceptance
  record, central usage/audit failures cannot precede the durable outcome, and
  request closure is the last execution-ledger publication.

The subsequent exact-head review also requires the parent to revalidate the
durable prepared transaction itself under the ledger lock. A missing or changed
execution record cannot accept a proposal or close the request; active request
ownership is retained for explicit reconciliation.

The result, transaction and request indexes remain separate individually atomic
snapshots. Publication failure can therefore require explicit reconciliation,
but request closure is never published before the transaction outcome; active
ownership is retained instead of making an ambiguous execution replayable.
Shared budget usage is also copied into the durable transaction. If the later
central budget/audit update fails, SCALER emits a reconciliation warning and
does not report the external execution as failed or invite a retry.

Focused build/review gates cover successful, failed, timed-out, aborted,
missing, foreign, late, duplicate and ownership-drift results; concurrent
one-use approval attempts; child state updates before usage accounting; and
sequential schedules. Final full-gate counts and exact-head review verdicts are
recorded in the continuation handoff rather than inferred from this plan.
