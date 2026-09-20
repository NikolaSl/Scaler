# PLAN-123 — P3 actual-host selected-tool envelope identity

## Observed acceptance gap

SC-08 requires a request-specific choice between direct deterministic execution,
the current agent with only the selected tool, and an isolated tool agent. The
current parent path narrows Pi's active tools from the `context` hook. The
installed Pi host, however, snapshots the system prompt and active tools before
that hook runs. A zero-network installed-host probe therefore observed the
original large tool and old prompt guidelines in the first provider request even
though SCALER's later log and live API state reported the compact selection.

The compact runtime catalog also records only name, a shortened description and
boolean schema/docs availability. Two tools whose schemas differ from 55 bytes
to more than 50 kB currently produce byte-identical catalog evidence. That is not
enough to admit a provider envelope, bind a route decision, or detect schema and
guideline drift.

## Bounded unit

1. Apply the initial parent active-tool selection from the installed host's
   `before_agent_start` lifecycle, before Pi snapshots the first provider
   request. Keep the `context` hook responsible for context injection and
   catalog rendering, not first-request selection. Preserve child-agent tool
   selections and the existing turn/agent-end restoration boundary.
2. Build a deterministic runtime envelope profile for the actual selected tool
   definitions. Include the complete name, description, parameter schema,
   prompt guidelines and source identity in a stable serialization; record its
   UTF-8 byte size and SHA-256 fingerprint. A change in any included field must
   change the identity. Do not inject the complete profile into the requester
   prompt.
3. Treat a selected-only profile as authoritative only when the installed host
   exposes all three active-tool APIs and the post-selection active set exactly
   matches the requested set. Otherwise report the injected footprint as unknown
   or whole-catalog; never infer savings from the compact catalog.
4. Persist or log enough request-local evidence to compare the selection and
   envelope identity before dispatch. Unknown profile fields, invalid sizes, a
   changed identity or an unavailable required host capability fail closed at
   the later route/admission boundary.

This unit is an enabling acceptance boundary. It does not fabricate a generic
direct tool executor: installed Pi exposes tool discovery/activation but no
generic `executeTool` API. Direct execution must remain blocked until an
explicit adapter can preserve the tool's permission, approval, result and
uncertain-effect semantics.

## Test-first evidence

Add a zero-network installed-host regression that activates a small selected
tool beside a large unselected tool and inspects the actual first provider JSON.
It must fail on the current `context`-hook timing, then prove that the large
tool's schema and guidelines are absent from the transported request while the
selected tool remains available. The test must inspect the payload rather than
only `setActiveTools` calls or SCALER logs.

Add pure profile regressions for:

- a 55-byte versus 50 kB parameter schema;
- description, prompt-guideline and source-identity changes;
- stable identity across object key insertion order;
- selected-only versus whole-catalog/unknown footprints;
- missing host APIs and post-selection mismatch.

Run the focused extension, tool-request and installed-host suites, followed by
build, full unit, mock integration and conformance/autopilot gates. Two
independent GPT-6 Astra/high reviews must inspect the exact candidate head.

## Implemented result

The installed Pi path now applies the initial parent tool focus during
`before_agent_start`, before the host snapshots tools and rebuilds its provider
request. Pi 0.80.3 retains the previous prompt inside that extension chain, so
SCALER verifies it with the installed host builder and returns a rebuilt prompt
containing only the selected snippets and guidelines. A later extension can
append its own instruction without reintroducing excluded material. An earlier
unreconcilable rewrite instead restores the previous tools and aborts at the
provider boundary; arbitrary earlier safety text is never silently discarded.

The zero-network host regression inspects the actual OpenAI-compatible JSON
body: the first request contains `scaler_task_report` and
`scaler_tool_request`, while a large previously active unselected tool's schema,
snippet and guideline are absent. The companion extension's marker remains.
Child agents retain their explicitly selected tools and the parent selection is
restored at the existing turn/agent-end boundary.

`buildRuntimeToolEnvelopeProfile` now produces a selected, whole-catalog or
unknown footprint. A selected footprint requires the host selection APIs and an
exact post-selection tool-set match. Its type-tagged canonical wire identity
contains complete names, descriptions, parameter schemas, prompt guidelines and
source metadata, then records UTF-8 byte size and SHA-256. Object key order is
stable; sparse holes, explicit `undefined`, `null` and empty arrays remain
distinct, and missing values cannot collide with user-shaped objects. Duplicate or
missing definitions, mismatched selections, cycles, unsupported values and
non-finite numbers return unknown with no size or fingerprint.

The request-start audit event records only the profile metadata and fingerprint,
not the full schemas or guidelines. The compact requester catalog remains
compact and does not expose those definitions.

Prompt-composition refusal is latched across provider attempts and queued
continuations until a fresh `before_agent_start` lifecycle successfully verifies
a supported composition. Provider cancellation happens synchronously before
state or audit I/O, and audit failures cannot suppress either the refusal or the
successfully rebuilt selected prompt. Installed-host regressions exercise both
audit-failure paths and a continuation without a new admission boundary.

Candidate verification after the review fixes:

- TypeScript build: passed;
- unit: 910/910;
- mock integration: 67/67;
- conformance/autopilot: 7/7;
- focused extension, installed-host and tool-request selection: 58/58;
- `git diff --check`: passed.

## Explicit limits

PLAN-123 does not complete AC-08 or implement the three route executors. It does
not choose a model, prove token savings, bound tool-result output, change safety
authority, or grant permissions. The next SC-08 unit must compare the complete
measured request envelope (system instructions, history, selected tool profile,
output reserve and model window), emit an explicit
`direct | current-agent | isolated | blocked` decision, and bind execution to
that exact decision. Isolated tool-agent provider admission and actual result
size accounting remain open.
