# PLAN-157 — Varied-window required-context FSM evidence

## Requirement and minimal approach

AC-07 requires the same focused-context task to obtain necessary information
under declared smaller and larger usable model windows. PLAN-156 already proves
the unknown-source research-to-exact-section state sequence with deterministic
worker and research outputs. Reuse that process; do not add another retrieval,
routing or model-selection subsystem.

## Bounded scenario

Run the successful unknown-source scenario with exact provider bindings and
task allowances of 32,768 and 131,072 tokens. Put the requested heading near
the end of a large authorized source that would exceed the smaller allowance if
delivered whole. In both cases assert that:

- research remains an attributed claim and does not itself supply source bytes;
- the worker requests an explicit authorized path and exact heading;
- the supervisor persists and freshness-binds only the requested section;
- the final attempt receives the necessary exact bytes, excludes unrelated
  source bytes, passes full prompt/provider admission and advances only to
  validation;
- attempt identities remain distinct across retries.

The 32K case demonstrates that exact scoping makes required information
admissible when whole-file delivery would not fit. The 128K case demonstrates
that a larger window does not justify injecting irrelevant source content.

## Limits and validation

The runners remain deterministic fixtures. This validates the model-independent
FSM, exact context delivery and window-bound admission; it does not execute a
local model, measure model quality, prove source truth or claim token savings.
If the current implementation passes, add only the integration evidence and
documentation. Run the focused scenario first, then the applicable build,
unit/mock-integration and conformance gate once on the candidate tree.
