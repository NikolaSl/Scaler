# PLAN-119 — P3 final prompt admission

## Problem

The current context resolver records split guidance for oversized required
context, but required items remain in the prompt. Conductor and debug-retry then
dispatch the unchanged prompt. Caller-supplied item estimates can also understate
the bytes that are finally serialized, and the task/report wrapper is added only
after context selection. A split record is diagnostic evidence, not authorization
to exceed the declared prompt allowance.

A reproduced conductor scenario used a 1,000-token allowance and one required
exact 40,000-character source. The runner was still called with a prompt of about
10,948 rough tokens, an attempt was created, the task entered `running`, and the
spawned-agent budget increased.

## Bounded first P3 unit

1. Measure the exact SCALER-owned final task prompt with the existing documented
   `characters / 4` estimator. This remains a rough conservative admission
   estimate, not a provider-tokenizer guarantee.
2. Include the fixed-length execution-attempt identity envelope in sizing before
   durable attempt admission. The sizing identity must never be dispatched or
   persisted.
3. Share the guard between conductor and debug retry. When an executable prompt
   exceeds its effective allowance, refuse before runner dispatch, task `running`
   transition, attempt creation, or spawned-agent budget consumption.
4. Preserve required exact bytes. Do not silently drop, summarize, or treat an
   externalized copy/split record as sufficient context.
5. Keep prepare-mode preview and split diagnostics available because they have no
   execution side effect.
6. Add regressions for oversized required exact context, understated item
   estimates, wrapper-only overflow, debug retry, and a sufficient-budget control.

## Explicit limits

This unit measures only the prompt serialized by SCALER. Pi/provider system
instructions, tool schemas, hooks, history, protocol framing, output reserve,
in-task tool results and provider-specific tokenization remain outside the
measured envelope. Later P3 work must add adapter-level accounting and retrieval
corrections. Passing this guard therefore means only that the known prompt is not
already over its declared allowance.

## Validation

Run focused conductor, debug-retry and context tests first, then the TypeScript
build, full unit suite, mock integration and conformance/autopilot gates. Obtain
two independent GPT-6 Astra/high exact-head reviews before treating this bounded
unit as complete.

## Result

Implemented on the P3 phase branch. Conductor and debug retry now size the final
SCALER-owned task prompt, including a fixed-length attempt-binding envelope,
before execution side effects. Oversized prompts and malformed allowances fail
closed before runner dispatch, attempt admission, task `running` transition, or
spawned-agent accounting. Persisted manifest allowances are also required to be
positive safe integers.

Validation at the final implementation tree:

- focused build and prompt/context tests: 64/64 passed;
- full TypeScript build and unit suite: 796/796 passed;
- mock integration: 67/67 passed;
- conformance/autopilot: 7/7 passed;
- two independent GPT-6 Astra/high exact-head reviews: no remaining actionable
  findings after the non-finite allowance correction.

This closes only the reproduced SCALER-prompt bypass. The provider envelope and
tokenizer limitations above remain the next P3 accounting boundary.
