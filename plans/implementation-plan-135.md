# PLAN-135 — Parent provider-envelope admission

## Status

Implemented; exact-head validation recorded below.

## Evidence and problem

PLAN-119 through PLAN-132 fail closed for strict child provider requests, but
the installed parent Scaler extension only blocks an unreconcilable selected-
tool prompt composition. Its ordinary `before_provider_request` hook does not
measure the final provider payload. The installed-host regression therefore
shows that a small user request plus an oversized real system/tool envelope is
still transported after Pi reduces the output allowance to one token.

That is an SC-05 gap: admission of the user text alone cannot authorize the
complete parent request assembled by the host.

## Bounded objective

Before every ordinary parent provider transport:

1. assess the exact final payload emitted by the installed host;
2. use the live parent model context window as the runtime-owned request limit;
3. retain an explicit output reserve and safety margin;
4. abort before transport when the model, payload, output limit or complete
   envelope is unsupported or oversized;
5. keep refusal independent from fallible audit persistence;
6. record only compact admission measurements and reason codes, never the full
   prompt or tool payload.

The existing prompt-composition refusal remains higher precedence. Strict child
requests keep their separately bound environment policy and are not admitted by
this parent hook.

## Test-first proof

- Turn the existing installed-host oversized-parent counterexample into a
  required refusal before transport.
- Preserve a bounded parent request and selected-tool first-request focus.
- Reject a reduced output allowance below the parent reserve.
- Verify refusal still occurs when its audit path fails.
- Verify the provider decision contains measurements but not transported
  prompt/tool bytes.

Run focused installed-host/provider tests after each meaningful change and the
full applicable build, unit/component, mock-integration, conformance and diff
gate on the candidate.

## Explicit boundaries

This unit does not establish exact tokenization, alternate provider APIs,
provider-internal retry interception, local-model quality, automatic splitting,
or the complete SC-05/AC-05 scenario. The estimator remains the conservative
serialized UTF-8 byte upper bound. Model-selection eligibility and direction
checks remain separate work.

## Result

The installed parent extension now evaluates each ordinary final provider
payload with the shared strict admission primitive and the live model context
window. Prompt-composition refusal retains precedence, child sessions retain
their environment-bound policy, and parent refusal calls `ctx.abort()` before
fallible compact telemetry. Accepted/refused audit events contain only the
decision code and numeric measurements.

The exact candidate passes the TypeScript build, `git diff --check`, 1,069
unit/component tests, 67 mock integration tests, 7 conformance/autopilot tests
and 15 focused installed-host provider checks.
