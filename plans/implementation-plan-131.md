# PLAN-131 — P3 strict child tool-load parity

## Observed prerequisite gap

PLAN-130 made unavailable extension-backed tool grants fail closed on the five
newly protected child-launch paths, but the same check is optional in the shared
task, debug-retry, stage and isolated-tool paths. Those callers can still build
a strict invocation that suppresses ambient extensions while advertising a
browser, MCP or custom-extension tool that the child cannot load.

This contradicts the strict invocation envelope and makes the PLAN-130 boundary
broader in documentation than in runtime behavior. Closing that parity gap is a
smaller prerequisite than adding exact host-model propagation or a new external
capability adapter.

## Bounded unit

1. Make loaded-tool validation intrinsic to every strict child invocation.
   A caller flag must not be able to disable the check.
2. Keep non-strict generic task-agent invocation behavior unchanged.
3. Preflight strict grants before attempt creation/start, spawned-agent budget
   charging, prepared-run publication or runner dispatch on affected callers.
4. Return the existing structured refusal shapes and release execution locks;
   do not leave an active attempt, accepted tool transaction or misleading
   prepared/successful record.
5. Preserve built-in Pi and SCALER tool grants and the explicit no-tools path.

## Test-first evidence

- a strict request refuses an unavailable tool even when the legacy opt-in flag
  is omitted or false;
- stage prepare/execute refuses custom grants without prompt audit, run record or
  runner call;
- conductor and debug retry refuse before attempt/spawn accounting and release
  their execution lock;
- isolated dispatch refuses an unavailable requested tool without accepting a
  result or proposal;
- built-in, SCALER and no-tools invocations retain their existing behavior;
- the installed Pi catalog check confirms the strict allowlist without a model
  request.

Run focused task-agent, stage, conductor, debug-retry and tool-request tests,
then build, the full unit/component suite, mock integration and
conformance/autopilot gates. Two independent GPT-6 Astra/high reviews inspect
the exact final tree.

## Explicit limits

This unit does not load browser/MCP/custom adapters, bind the exact
parent-selected provider/model, admit parent interactive calls, classify task
complexity, implement automatic splitting, complete the three-route scenario or
claim local-model quality, savings or scale. SC-05, SC-08, SC-09 and SC-25 remain
partial until their separate behavioral and real-host evidence exists.
