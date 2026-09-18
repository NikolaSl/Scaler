# PLAN-120 — P3 strict provider-payload admission

## Reproduced defect

PLAN-119 measures the final prompt serialized by SCALER, but Pi adds its system
prompt, active tool schemas, hook/context messages, history and provider framing
after that check. A no-network Pi 0.80.3 SDK fixture used a 7-token task prompt,
an OpenAI-compatible model with an 8,000-token window and 1,000-token output
limit, one read tool, and a 40,000-character host system prompt. PLAN-119 admitted
the task. Pi then called the synthetic transport once with a 41,078-character
provider payload and reduced `max_completion_tokens` to 1 instead of refusing
the oversized input.

Pi catches exceptions from `before_provider_request` handlers and continues.
The same installed-host fixture proved that throwing still reached the transport,
while `ctx.abort()` stopped it before the fetch.

## Bounded unit

1. Add a strict provider-payload admission policy to conductor and debug-retry
   child requests. Transport only validated numeric limits through the child
   environment; never transport prompt content or credentials.
2. Disable ambient child extension, skill, prompt-template and context-file
   discovery. Load a small provider-admission extension explicitly and last.
   Reject additional extension configurations for this first strict profile so
   no later payload-rewrite hook can invalidate the decision.
3. At `before_provider_request`, inspect the actual final OpenAI Chat Completions
   payload. Its serialized bytes include the system message, selected tool
   schemas, history, injected context, pending tool results and provider framing.
4. Compare a named conservative byte upper-bound estimate plus an explicit
   useful output reserve and safety margin against both the task allowance and
   selected model context window. Reject missing, malformed, conflicting or
   unsupported strict inputs rather than guessing.
5. On refusal, call `ctx.abort()` synchronously before best-effort durable
   diagnostics. Throwing is not the enforcement mechanism. Preserve required
   content; do not trim the payload to force admission.
6. Keep PLAN-119 as an earlier necessary guard so obviously oversized work is
   rejected before starting a child process.

## Test-first evidence

- Pure payload scenarios independently cover system content, tools, history and
  tool-result growth, output reserve, safety margin, boundary equality, task and
  model limits, malformed limits and unsupported payloads.
- Child invocation tests cover validated policy transport, inherited-policy
  removal, ambient-resource suppression, admission loading for tool-less strict
  children and rejection of additional extensions.
- A real installed Pi SDK fetch-stub regression proves the reproduced oversized
  request reaches the transport before the fix and is aborted before transport
  after the fix. A sufficient-envelope control must still reach the stub once.
- A host-semantics regression preserves the distinction between swallowed hook
  exceptions and effective `ctx.abort()` cancellation.

## Explicit limits

This unit supports only the installed Pi 0.80.3 OpenAI Chat Completions text/tool
payload shape used by the deterministic fixture. The byte estimator is a safe
upper bound, not tokenizer-accurate measurement, and may reject requests that a
verified tokenizer could admit. Parent interactive calls, other child routes,
alternate provider APIs, image/audio payloads, provider-internal retries,
post-admission mutation by unsupported extensions and estimate-versus-observed
token reconciliation remain later P3 work. No real network request, paid model
or deployment is authorized for this unit.

## Validation

Run focused provider-admission, subprocess and installed-host SDK tests, then the
TypeScript build, full unit suite, mock integration and conformance/autopilot
gates. Obtain two independent GPT-6 Astra/high exact-head reviews before treating
this bounded unit as complete.
