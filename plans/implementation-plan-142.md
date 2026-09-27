# PLAN-142 — P3 measured final-prompt split trigger

## Status

In progress on the P3 preparation branch; final phase review and merge remain
pending.

## Observed prerequisite gap

PLAN-138 and PLAN-141 can project a recorded oversized-context split into the
normal conductor and debug retry execution paths. Split recording still trusts
caller-supplied per-item token estimates and is triggered only by the
context-only 75% target. A required exact item can therefore understate its
size, leave the context assessment apparently below target, and make the
complete attempt-bearing prompt exceed its allowance. Final prompt admission
correctly refuses dispatch, but the already available safe projection is never
attempted.

## Bounded unit

1. Measure large exact/summary-ok split candidates from their actual content;
   a caller estimate may be more conservative but may not hide bytes.
2. When an executed complete attempt-bearing prompt exceeds a valid allowance,
   permit split recording even if the context-only target did not trigger it,
   but only when at least one measured item is eligible for externalization.
3. Record whether the split was triggered by the active-context target or by
   final-prompt overflow, including the measured prompt overage.
4. Reuse the existing projection, `read` admission, shrink check, attempt
   freshness and result-acceptance boundaries in conductor and debug retry.
5. Preserve wrapper-only and non-shrink refusal: a forced record is not created
   when no item can be externalized, and no over-limit prompt is dispatched.

## Test-first evidence

- an understated large exact item is still selected for externalization;
- normal conductor execution projects and dispatches a smaller admitted prompt
  instead of stopping at the understated context estimate;
- debug retry receives the same measured final-prompt trigger;
- missing `read`, non-shrinking projection, malformed allowance and
  wrapper-only overflow remain fail-closed before attempt or runner dispatch;
- ordinary correctly estimated split behavior remains unchanged.

Run focused compression/context-split/conductor/debug-retry/attempt checks after
meaningful changes, followed by the full build, unit/component, mock-integration,
conformance/autopilot and diff gate on the candidate.

## Explicit limits

This unit does not add semantic selector inference, task decomposition, a new
executor, automatic retry policy, local-model execution, or evidence of model
quality, savings or scale. It closes only the measured trigger gap around the
existing effective split implementation; SC-07 remains Partial.
