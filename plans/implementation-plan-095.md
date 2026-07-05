# Implementation Plan 095: Parent-session compact tool catalog and active-tool focus

## Gap
GAP-033: requester-agent parent sessions still receive broad active tools/docs in Pi unless operators manually restrict them; SCALER has not yet used Pi `getAllTools`/`getActiveTools`/`setActiveTools` to expose compact catalogs and narrow active tools around SCALER-guided turns.

## Scope
- [x] IMPL-359: Add runtime Pi tool introspection helpers that format only compact catalogs (name, short purpose, risk, docs/schema availability, active flag) without parameter schemas or prompt guidelines.
- [x] IMPL-360: Add parent-session active-tool focus/restore helpers and command/UI affordances that snapshot active tools, narrow requester turns to SCALER requester tools, and restore the original active set.
- [x] IMPL-361: Wire automatic focus/catalog injection into the Pi `context`/turn lifecycle for SCALER-guided turns, with audit logging and tests proving full schemas/docs are not injected.

## Validation
- Unit tests for compact catalog formatting and requester-tool selection.
- Extension-shape tests for `getAllTools`/`getActiveTools`/`setActiveTools` focus/restore and context-hook catalog injection.
- Targeted real command coverage where practical.
- Full `npm run build`, `npm test`, and `./scripts/run-real-integration.sh` after the slice.
