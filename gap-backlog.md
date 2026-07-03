# SCALER Gap Backlog

Derived from `traceability-matrix.md`. Keep this file focused on uncovered or partial PRD requirements.

Priority scale:

- **P0**: needed to satisfy core SCALER architecture or prevent unsafe/unreliable operation.
- **P1**: important reliability/quality requirement.
- **P2**: useful maturity/integration requirement.

## P0 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-001 | PRD-W01..W05, PRD-G01 | Stage I-IV artifact records and commands exist, but automatic PRD, knowledge, planner, and execution stage agents are not orchestrated end-to-end. | Add stage conductor commands/agents that produce and validate PRD, knowledge, planner, and execution artifacts. |
| GAP-002 | PRD-S04, PRD-G02, PRD-P01 | Task context manifests now resolve state, task metadata, files, memory refs, validation manifests, PRD refs, and missing context, but source discovery/ranking remains basic. | Add automatic relevance discovery from changed files, plans, PRD coverage, validation history, and memory search results. |
| GAP-003 | PRD-S25, PRD-S31, PRD-W08, PRD-G04 | Versioned runtime PRD/execution plan artifacts, replan requests, preservation checks, blocked-evidence triggers, and proposal acceptance exist, but no planner agent generates proposed replacement plans. | Add planner/replanner agent that consumes replan requests and runtime PRD coverage to write `.scaler/plans/proposed-plan.json` automatically. |
| GAP-004 | PRD-S06, PRD-S07, PRD-W03 | Research agents and evidence handling are missing. | Add research request/report schema, source quality/confidence fields, contradiction handling, and raw-evidence storage in memory. |
| GAP-005 | PRD-S16, PRD-S02 | Audit logging is incomplete for prompts/tool calls/full reports. | Extend logging to cover command starts/ends, agent prompts, tool requests/results, transitions, validation summaries, and commit ids. |

## P1 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-006 | PRD-S10, PRD-S11, PRD-P02 | Compression and exact-preservation workflow missing. | Add compression policy docs/prompts plus structured exact data references and split/externalize recommendations. |
| GAP-007 | PRD-S18, PRD-P03 | Budget/watchdog enforcement is basic. | Add real counters/enforcement for wall time, spawned agents, validation loops, debug attempts, storage, and token estimates. |
| GAP-008 | PRD-S20, PRD-P06 | Debug-cycle detection can request replanning and mark debugging tasks `needs_replan`, but repeated failed fingerprints are not yet a hard conductor retry gate. | Block conductor retries after repeated failed fingerprints unless new evidence or an accepted replan request exists. |
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
| GAP-018 | PRD-W04, PRD-S25, PRD-S31 | Execution plan artifacts can link tasks to PRD refs and create task records, but no planner agent writes/verifies full PRD coverage automatically. | Make future planner output create/update runtime PRD requirements, current execution plan tasks, task `prdRefs`, and coverage checks before execution. |

## Closure rule

A gap can be closed only when:

1. The implementation is committed under an IMPL task.
2. Relevant tests pass and are committed.
3. Manual docs describe only implemented behavior.
4. `traceability-matrix.md` and this backlog are updated in the same task or immediately following traceability task.
