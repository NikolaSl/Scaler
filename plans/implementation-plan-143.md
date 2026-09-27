# PLAN-143 — P3 measured aggregate context accounting

## Status

Implemented on the P3 preparation branch; final phase review and merge remain
pending.

## Observed prerequisite gap

PLAN-142 prevents an individual caller estimate from hiding a large inline
exact/summary-ok item and can trigger projection from complete final-prompt
overflow. The compression assessment's aggregate `estimatedTokens` still comes
from the resolved caller estimate, however. Several understated inline items can
therefore leave the active-context estimate, split trigger and durable overage
below their measured content total. Execution remains protected by final-prompt
admission, but preparation and audit evidence are inaccurate and safe ordinary
target-triggered projection can be missed.

## Bounded unit

1. Derive aggregate compression usage from the greater of the valid supplied
   total and the sum of per-item measured/conservative estimates.
2. Preserve conservative caller totals when they exceed measured item content.
3. Use the corrected total consistently for `overTarget`, `overByTokens`, split
   records, compression guidance and conductor active-context budget accounting.
4. Keep malformed/negative/non-safe item estimates non-authoritative and retain
   existing final-prompt admission, externalization, shrink and freshness gates.
5. Do not invent an externalization candidate when every item is below the
   configured large-item threshold; those requests continue to refuse or require
   another bounded strategy.

## Test-first evidence

- several individually understated inline items trigger the aggregate target;
- a conservative supplied aggregate remains authoritative when larger;
- malformed item estimates cannot inflate arithmetic or hide measured bytes;
- conductor preparation records a measured aggregate split without requiring an
  execute-only final-prompt trigger;
- accepted conductor execution records measured active-context usage rather than
  a caller-understated total;
- ordinary correctly estimated and wrapper-only refusal behavior remains intact.

Run focused compression/context-split/conductor checks after meaningful changes,
then the full build, unit/component, mock-integration, conformance/autopilot and
diff gate on the candidate.

## Explicit limits

This unit does not add semantic retrieval, automatic selector choice, task
decomposition, a new executor, model execution, or evidence of quality, savings
or scale. It corrects aggregate accounting around the existing split boundary;
SC-07 remains Partial.

## Implementation evidence

- `assessCompression` sums the same measured/conservative per-item estimates
  used for large-item eligibility and clamps accumulation to a safe integer.
- The durable aggregate is the greater of that sum and a valid non-negative
  supplied total; malformed totals and item estimates are non-authoritative.
- Conductor preparation now records an `active_context_target` split for the
  reproduced understated aggregate while preserving an empty externalization
  set when every item remains below the configured threshold.
- Conductor budget admission publishes the same measured aggregate used by the
  compression decision, so an accepted dispatch cannot report the caller's
  understated total as active-context usage.

## Validation evidence

- TypeScript build and `git diff --check` pass.
- Full gates pass: 1,125/1,125 unit/component, 67/67 mock integration and 7/7
  conformance/autopilot checks.
- The PLAN-143 compression/context-split/conductor selection passes 58/58.
