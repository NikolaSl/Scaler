# PLAN-126 — P3 isolated execution output bounds

## Observed prerequisite gap

PLAN-125 binds one structured proposal to one successful isolated process, but
the process transport and result ledger remain unbounded. `runTaskAgent` keeps
all stdout events and stderr in memory, decodes each chunk independently, and
does not report observed wire bytes. `recordToolResult` can also persist an
arbitrarily large execution-bound proposal. A child can therefore exhaust the
parent before the PLAN-125 acceptance boundary runs.

PLAN-124 route evidence cannot yet be made authoritative safely. The exact
worker provider payload exists only inside the child host's
`before_provider_request` hook, and the caller-continuation payload has no
trusted dispatch-time supplier. Treating caller-provided snapshots as the live
payload would create misleading route identity. This unit closes the output
prerequisite without authorizing route advice.

## Bounded unit

1. Define runtime-owned positive-safe-integer limits for isolated stdout,
   stderr and the complete serialized result proposal. Persist the exact limit
   set on every execution transaction before spawning the worker. Model-facing
   request/result schemas cannot select or increase these values.
2. Count raw stdout/stderr `Buffer` bytes before decoding. Use streaming UTF-8
   decoding, retain no bytes beyond the cap, latch the first violated stream,
   and terminate the owned process through the existing TERM/KILL boundary.
3. Report observed stdout/stderr byte counts and the latched limit failure in
   `TaskAgentRunResult`. A limit failure rejects acceptance regardless of exit
   code or an already-recorded completed proposal.
4. Normalize result-controlled values into immutable JSON data, measure the
   complete UTF-8 JSON representation of the proposal, and reject oversized or
   non-serializable data before ledger or audit publication.
5. Revalidate the durable transaction limits, observed process measurements
   and stored proposal bytes during parent finalization. Unknown, malformed,
   changed or excessive evidence fails closed.
6. Replay, iteration and schedule use the same runtime limits. Approval is not
   consumed when limits cannot be established before the execution claim.

Initial conservative limits are 4 MiB stdout, 1 MiB stderr and 1 MiB per
serialized result proposal. These are transport safety bounds, not context
budget or child-process memory claims.

## Test-first evidence

- stdout at the exact raw-byte limit succeeds; one byte over terminates and
  blocks, including one-chunk, many-chunk and no-newline output;
- split multibyte UTF-8 is decoded without corruption while raw bytes remain
  authoritative;
- stderr overflow and a TERM-ignoring child remain bounded and reach confirmed
  process termination;
- a completed proposal followed by output overflow is rejected even if the
  child exits zero;
- oversized summary, outputs, evidence, validation, errors and recommendations
  cannot publish a proposal; JSON escaping and multibyte values count encoded
  bytes;
- persisted proposal growth or transaction-limit drift before finalization is
  rejected;
- replay, iteration and schedule cannot bypass the same limits;
- serialization failures preserve the previous index and release the ledger
  writer; accepted structured output is never silently truncated.

Run focused subagent, tool-request, ledger-concurrency and extension checks,
then build, full unit, mock integration and conformance/autopilot gates. Two
independent GPT-6 Astra/high reviews inspect the exact final head.

## Explicit limits

This unit does not bind PLAN-124 advice to execution, add direct/current-agent
adapters, prove the worker and caller-continuation payloads, certify every
provider call, contain descendant memory/filesystem effects, or prove local
model quality or savings. Strict isolated-provider admission, a trusted live
envelope supplier and dispatch-basis freshness remain later SC-08 work.
