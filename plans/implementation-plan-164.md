# PLAN-164 — P3 integrated AC-05 envelope milestone

## Reassessment

The individual SC-05 boundaries already exist: oversized required context can
be externalized into a resolvable split, installed Pi measures the final host
payload and reserves output space, large tool results are externalized before
the continuation, and conductor permits one separately admitted report-only
repair. AC-05 remains open because those boundaries have not been exercised in
one declared-window process and the admission estimate has not been reconciled
with provider-observed usage.

The minimal sufficient change is one integration scenario. No new production
abstraction or retry policy is justified unless the composed test reproduces a
real gap.

## Bounded unit

1. Run one conductor task under a declared 32,768-token provider window with an
   oversized exact source and verify that the dispatched prompt contains the
   resolvable split reference, not the original bytes.
2. Deliver that prompt through the installed Pi host with its real SCALER
   extensions and synthetic transport. Select one tool, return a 9 KB result,
   and verify that the second admitted provider payload contains only the
   externalized reference.
3. Return a successful process without a valid task report, then exercise the
   existing one-shot, tool-less, same-attempt report repair and require a valid
   validation handoff.
4. Extract provider-observed usage from the installed-host messages and prove
   that the durable run record and budget ledger reconcile the conservative
   pre-dispatch estimate with that observed increment.
5. Keep every model response synthetic and deterministic. This verifies the
   model-independent FSM and envelope controls, not model quality, savings or
   configured local inference.

## Validation

Run the focused integrated host/conductor scenario first. If it passes without
production changes, update SC-05 evidence and run the TypeScript build, full
unit/component, mock-integration and conformance/autopilot gates plus
`git diff --check`. Obtain a fresh-context GPT-5.6 Terra/high exact-head review
before merging the coherent P3 phase PR.

