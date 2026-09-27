# PLAN-143 — P3 measured aggregate context accounting

## Status

In progress on the P3 preparation branch; final phase review and merge remain
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
   records and compression guidance.
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
- ordinary correctly estimated and wrapper-only refusal behavior remains intact.

Run focused compression/context-split/conductor checks after meaningful changes,
then the full build, unit/component, mock-integration, conformance/autopilot and
diff gate on the candidate.

## Explicit limits

This unit does not add semantic retrieval, automatic selector choice, task
decomposition, a new executor, model execution, or evidence of quality, savings
or scale. It corrects aggregate accounting around the existing split boundary;
SC-07 remains Partial.
