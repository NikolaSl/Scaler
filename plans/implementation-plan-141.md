# PLAN-141 — P3 effective context split for debug retry

## Status

In progress on the P3 preparation branch; final phase review and merge remain
pending.

## Observed prerequisite gap

PLAN-138 lets normal conductor execution externalize oversized exact context and
dispatch a smaller freshness-bound projection through the ordinary attempt and
provider-admission path. The debug next-approach retry path still measures and
rejects the unchanged oversized prompt, even though it uses the same manifest,
prompt builder, attempt admission and task-agent boundary.

## Bounded unit

1. Reuse the existing context-split record, externalization and projection
   implementation in executed debug retries; do not introduce a second split
   format or an alternate executor.
2. Include the required next-approach debug item in the split basis, preserve it
   in the projected prompt, and require `read` whenever exact bytes were
   externalized.
3. Rebuild and remeasure the complete attempt-bearing prompt after projection.
   Refuse when projection fails, does not shrink, or remains over the allowance,
   before attempt, spawned-agent accounting or runner dispatch.
4. Admit the projected context through the existing attempt boundary and retain
   original plus externalized source freshness through result acceptance.
5. Keep prepare mode read-only with respect to execution state and preserve the
   existing fail-closed behavior when no effective projection exists.

## Test-first evidence

- the current oversized debug-retry fixture first demonstrates the missing
  projection behavior;
- an executable oversized exact item dispatches only a smaller reference-bearing
  prompt and preserves the required next-approach instructions;
- an externalized projection without `read` refuses before runner and attempt;
- a non-shrinking or still-oversized projection refuses before dispatch;
- mutation of externalized evidence during the retry makes result acceptance
  fail closed;
- unchanged ordinary debug retries retain their existing behavior.

Run focused debug-retry/context-split/attempt checks after each meaningful
change, then the full build, unit/component, mock-integration,
conformance/autopilot and diff gate on the candidate.

## Explicit limits

This unit does not infer selectors, decompose a task, retry automatically,
change retry approval policy, provide a production local model, prove quality or
savings, or complete SC-07. It only applies the already implemented effective
split boundary to one existing strict child route.
