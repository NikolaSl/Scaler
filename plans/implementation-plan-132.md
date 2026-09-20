# PLAN-132 — P3 exact host-selected child model binding

## Observed prerequisite gap

PLAN-119 through PLAN-131 bound strict child prompts, provider envelopes and
loaded tools, but exact provider/model identity remains optional outside the
isolated tool-dispatch path. The production command surface does not pass the
host's current `ctx.model` into conductor, stage, research, diagnostic debug,
debug-retry, replanning or schema-discovery children. Explicit task spawn instead
accepts a model string from the model-authored tool payload.

Consequently a strict child can omit the exact-model environment binding and
select an ambient provider/model while still passing the size envelope gate.
The installed Pi resolver also shows that a bare shared model id can resolve to
an authenticated cloud provider instead of an intended local provider. Exact
selection therefore requires both an explicit provider/model CLI selector and
the existing final transport-hook identity check.

This is a reproduced authority gap and a prerequisite for honest SC-05, SC-09
and SC-25 evidence. It is smaller and safer than adding a new provider adapter,
automatic splitting or a production three-route continuation supplier.

## Bounded unit

1. Treat an exact provider/API/model/context-window identity as mandatory for
   every strict child invocation. Missing, malformed or inconsistent identity
   must fail before runner dispatch or execution-side publication.
2. Derive the child CLI's explicit `--provider` and `--model` selection from the
   same trusted identity exported to the provider-admission hook. Do not allow a
   separate caller model string to select a different provider or model. Bind
   attempt identity to that unambiguous provider/model route instead of
   `provider-default` or a bare shared model id.
3. Capture the installed host's current `ctx.model` at command/tool entrypoints
   and thread it through conductor, debug retry/conductor, stage workflows,
   research workflows, diagnostic debug, replanning, schema discovery and
   explicit task spawn.
4. Preserve isolated-tool execution/replay's fresher dispatch-time supplier and
   exact model binding. Do not replace it with ambient command state.
5. Preserve deliberately non-strict generic invocation compatibility, prepare
   mode, locks, tool admission, budgets, report ingestion and usage accounting.

## Test-first evidence

- strict invocation refuses a missing, malformed or model-string-mismatched
  exact identity before a subprocess can start;
- identical model ids under different providers render an unambiguous provider
  plus model selector and the hook rejects any live identity drift;
- production command/tool entrypoints use host-owned model identity rather than
  a model-authored spawn override;
- stage/debug/research/replan/conductor fan-outs preserve the same immutable
  identity through nested workflows;
- schema discovery refuses before a prepared run when the identity is missing;
- isolated dispatch retains its fresh supplier-bound identity and replay rules;
- non-strict invocation behavior remains unchanged.

Run focused task-agent, extension-shape, conductor, debug, stage, research,
replan, schema-discovery and spawn tests; then build, the full unit/component
suite, mock integration and conformance/autopilot gates. Two independent GPT-6
Astra/high reviews inspect the exact final tree.

## Explicit limits

This unit does not establish model eligibility policy, configure or call a local
model, add cloud/local credentials, support a new provider API, admit parent
interactive calls, change provider retry behavior, implement automatic task
splitting, complete the three tool routes or claim model quality, savings or
scale. SC-05, SC-08, SC-09 and SC-25 remain Partial/Not assessed until their
separate real-host and behavioral evidence exists.
