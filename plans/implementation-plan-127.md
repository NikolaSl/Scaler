# PLAN-127 — P3 isolated dispatch route admission

## Observed prerequisite gap

PLAN-124 can assess a complete route envelope, but its result is advisory and
caller-supplied. PLAN-125 and PLAN-126 safely bind and bound an isolated child
after dispatch. `runToolRequestAgent`, replay, iteration and schedule still
start that child without recomputing the route from live provider envelopes.
An old or fabricated assessment can therefore appear feasible while the actual
worker or caller-continuation request no longer fits its provider policy.

The installed Pi command surface does not currently expose a trustworthy
future caller-continuation payload. It must fail closed rather than reconstruct
one from prior messages or treat PLAN-124 advice as authorization.

## Bounded unit

1. Require an injected runtime envelope supplier for every isolated execution.
   The supplier is a function owned by the host integration, not model input or
   persisted request data. Invoke it after the execution transaction is claimed
   and immediately before the child runner.
2. Give the supplier the runtime-owned request and execution identities. Require
   its snapshot to echo both identities and contain the complete live worker and
   caller-continuation provider legs plus the current selected-tool profile.
3. Rebuild the request basis from the persisted tool request, recompute the
   PLAN-124 assessment, and admit only `isolated` with allowed authority and a
   valid isolation requirement. The assessment remains non-authorizing; the
   parent supervisor owns the separate dispatch decision.
4. Persist only compact admission identity and measurements on the transaction.
   Never persist provider payloads or accept a previously recorded assessment.
5. Missing, throwing, malformed, foreign or stale supplier evidence rejects the
   claimed transaction, releases request ownership and never calls the runner.
6. Replay obtains a fresh snapshot for the new execution. Iteration and schedule
   thread the same supplier through every execution and cannot reuse a receipt.
7. Revalidate the durable admission identity during result finalization. Changed
   or missing admission evidence rejects the result even after a zero exit.

Until the installed host supplies both live legs, its execute commands are
expected to refuse isolated dispatch. Preparation remains available.

## Test-first evidence

- execute without a supplier rejects before runner invocation and releases the
  request;
- exact fresh worker and caller-continuation evidence admits one isolated run;
- wrong request/execution identity, malformed profile, missing leg, provider
  overflow, non-isolated recommendation and supplier failure reject;
- a persisted PLAN-124 assessment cannot substitute for live evidence;
- mutation/removal of the durable admission before finalization rejects an
  otherwise successful child result;
- replay calls the supplier with the new execution identity; iteration and
  schedule cannot bypass the supplier or reuse an earlier snapshot;
- audit/transaction records contain compact fingerprints and measurements, not
  raw prompts, tool arguments, provider payloads or model messages.

Run focused tool-routing/tool-request/ledger tests, then build, full unit, mock
integration and conformance/autopilot gates. Two independent GPT-6 Astra/high
reviews inspect the exact final head.

## Explicit limits

This unit does not implement a Pi host supplier for a future continuation that
the host cannot currently expose, direct/current-agent execution adapters,
descendant containment, provider quality, savings or scale. It closes the
unsafe default by making isolated execution unavailable without a trustworthy
live supplier. SC-08/AC-08 therefore remains partial.
