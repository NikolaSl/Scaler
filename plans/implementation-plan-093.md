# Implementation Plan 093: Audit redaction and large tool-result references

## Gap
GAP-031: audit logging is broad, but secret redaction and `tool_result` large-output externalization are not deterministic Pi hooks.

## Scope
- IMPL-353: Add deterministic audit redaction utilities for known secret/token/private-key patterns and apply them to event/audit detail serialization.
- IMPL-354: Add `.scaler/logs/tools/` large tool-result reference storage and a Pi `tool_result` hook that replaces oversized active-context content with a compact reference.
- IMPL-355: Document and test redaction/reference behavior across unit, mocked/extension, and opt-in real Pi paths where practical.

## Validation
- Unit tests for recursive redaction, audit detail/event serialization, and large tool-result externalization.
- Extension-shape coverage for the `tool_result` hook mutation.
- Targeted real Pi safety/tool-result coverage where practical.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
