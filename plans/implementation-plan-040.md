# Implementation Plan 040 — Real Pi JSON Event Extraction Fix

## Goal
Make optional real Pi integration tests exercise the same structured report ingestion contracts as mocked tests by supporting Pi `--mode json` event streams where the model's final structured JSON object is carried inside assistant message text.

## Problem
Mock runners emit direct top-level `scaler_*` JSON events. Real `pi --mode json` emits Pi session/message events, and the assistant's final JSON object appears as exact text content within those events. Current SCALER report extractors only inspect top-level or shallow nested event payloads, so real Pi contract tests fail even when the model obeys the cardinal instruction.

## Structured-only preservation rule
This fix must not ingest arbitrary prose. SCALER may ingest a child-agent report from Pi wrapper events only when assistant text is exactly one parseable JSON object whose `type` matches the expected `scaler_*` report type. Text with surrounding prose, markdown fences, or non-matching types remains rejected.

## Atomic tasks

### PLAN-040 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-152 — Extract structured reports from Pi JSON wrapper events
- Add a shared helper for structured child report extraction.
- Preserve support for direct mock events and nested `payload`/`data` wrappers.
- Add support for assistant `text`, `content`, or `delta` values inside Pi JSON event records when the text is exactly a JSON object of the expected type.
- Wire debug, research, stage, and replan agent extractors to the helper.
- Add deterministic unit tests that cover direct events, nested events, Pi assistant-text events, and prose rejection.
- Run targeted unit tests plus `npm test` and `npm run build`.

### IMPL-153 — Align real Pi runner defaults and contracts
- Update the real integration runner script to default to `openai-codex/gpt-5.3-codex-spark` so subprocess execution uses the provider shown by `/model` instead of ambiguous model-name resolution.
- If needed, update real integration documentation to mention provider-qualified model values.
- Run the real integration suite with `SCALER_REAL_PI_INTEGRATION=1` when credentials are available in the current environment.
- Run `npm test` and `npm run build`.

## Validation

Default deterministic validation:

```bash
npm test
npm run build
```

Real contract validation:

```bash
cd test/integration/real
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=openai-codex/gpt-5.3-codex-spark \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
node --test --import tsx *.test.ts
```
