# SCALER Gap Backlog

Derived from `traceability-matrix.md`. Keep this file focused on uncovered or partial PRD requirements.

Priority scale:

- **P0**: needed to satisfy core SCALER architecture or prevent unsafe/unreliable operation.
- **P1**: important reliability/quality requirement.
- **P2**: useful maturity/integration requirement.

## P0 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-001 | PRD-W01..W05, PRD-G01 | Full Stage I-IV workflow is incomplete. | Implement stage artifact model and conductor commands for PRD, knowledge, planner, and execution stages. |
| GAP-002 | PRD-S04, PRD-G02, PRD-P01 | Context selection is still skeleton-level. | Add task context manifests that resolve current state, relevant files, memory refs, validation needs, and omissions. |
| GAP-003 | PRD-S25, PRD-W08, PRD-G04 | Replanning/versioned plans are mostly missing. | Add `plans/current-plan.json`, plan versions, evidence-driven replan triggers, and preservation of validated tasks. |
| GAP-004 | PRD-S06, PRD-S07, PRD-W03 | Research agents and evidence handling are missing. | Add research request/report schema, source quality/confidence fields, contradiction handling, and raw-evidence storage in memory. |
| GAP-005 | PRD-S16, PRD-S02 | Audit logging is incomplete for prompts/tool calls/full reports. | Extend logging to cover command starts/ends, agent prompts, tool requests/results, transitions, validation summaries, and commit ids. |

## P1 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-006 | PRD-S10, PRD-S11, PRD-P02 | Compression and exact-preservation workflow missing. | Add compression policy docs/prompts plus structured exact data references and split/externalize recommendations. |
| GAP-007 | PRD-S18, PRD-P03 | Budget/watchdog enforcement is basic. | Add real counters/enforcement for wall time, spawned agents, validation loops, debug attempts, storage, and token estimates. |
| GAP-008 | PRD-S20, PRD-P06 | Debug-cycle prevention is not yet a supervisor gate. | Make repeated failed fingerprints block task progress and require new evidence/replan before retry. |
| GAP-009 | PRD-S21..S24, PRD-W06..W07 | Validation gates need richer software and non-software support. | Add typed validation categories, non-software checklists, acceptance evidence fields, and stronger manifest defaults. |
| GAP-010 | PRD-S26, PRD-S27 | Safety/security/sandbox controls are partial. | Add internet/deploy/publish/secret gates, sandbox-mode metadata, and optional dependency/image scanner commands. |
| GAP-011 | PRD-S17 | `.scaler/` storage management missing. | Add storage usage scan, retention policy, report rotation, memory indexing, and hard pause on limits. |
| GAP-012 | PRD-S08, PRD-S09, PRD-P04 | Tool/MCP isolation needs deeper implementation. | Add tool catalog builder, tool-agent result schema, and focused tool transaction execution records. |

## P2 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-013 | PRD-S03 | Adaptive orchestration only selects a starting stage. | Add escalation/de-escalation rules driven by validation failures, uncertainty, risk, and budgets. |
| GAP-014 | PRD-S14, PRD-W05 | Task-agent run/report lifecycle needs tightening. | Require report ingestion from executed child agents before validation and track missing/invalid reports. |
| GAP-015 | PRD-S15 | Atomic task size is documented but not checked. | Add planner/task creation hints and optional warnings for tasks without DoD, validation, or allowed paths. |
| GAP-016 | PRD-S28 | Commit workflow lacks post-commit artifact/report. | Record commit id, task id, included paths, and validation summary in `.scaler/reports/commits.json`. |
| GAP-017 | PRD-S12, PRD-S13 | Memory retrieval is exact-id only. | Add tag/search filtering and summary references for task prompts. |

## Closure rule

A gap can be closed only when:

1. The implementation is committed under an IMPL task.
2. Relevant tests pass and are committed.
3. Manual docs describe only implemented behavior.
4. `traceability-matrix.md` and this backlog are updated in the same task or immediately following traceability task.
