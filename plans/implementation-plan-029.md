# Implementation Plan 029 — Research Evidence Foundation

## Goal
Advance GAP-004 by adding deterministic research request/report ledgers with source quality, confidence, contradiction tracking, and raw-evidence preservation outside active context.

## Scope
- Add `.scaler/research/` artifacts for research requests and research reports.
- Add structured research requests with status, scope, task links, and runtime PRD refs.
- Add structured research reports with sources, quality ranking, conclusions, confidence, contradictions, unresolved unknowns, recommendations, and memory references.
- Preserve raw research evidence into `.scaler/memory/` while keeping reports concise.
- Add commands/tools for creating requests, recording reports, and viewing research status.
- Update Stage II/knowledge documentation and traceability.

## Out of Scope
- Real internet search/browser automation.
- MCP-specific catalog discovery.
- Multi-agent research orchestration loops.
- Automatic contradiction resolution beyond structured status fields.

## Atomic Tasks
1. **IMPL-119 — Add research ledger and evidence storage**
   - Implement `src/research.ts` with request/report types, validation, persistence, source quality ranking, report formatting, and raw-evidence-to-memory storage.
   - Add focused unit tests.
   - Validate with `npm test` and `npm run build`.
2. **IMPL-120 — Add research commands and tool**
   - Add command parsing and commands for request/status/report recording.
   - Add `scaler_research_report` structured tool.
   - Add command/tool tests.
   - Validate with `npm test` and `npm run build`.
3. **IMPL-121 — Document research evidence workflow**
   - Update manuals, implementation inventory, traceability, and gap backlog.
   - Validate with `npm test` and `npm run build`.

## Validation
Run after implementation tasks:

```bash
npm test
npm run build
```
