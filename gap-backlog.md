# SCALER Gap Backlog

Derived from `traceability-matrix.md`. Keep this file focused on uncovered or partial PRD requirements.

Priority scale:

- **P0**: needed to satisfy core SCALER architecture or prevent unsafe/unreliable operation.
- **P1**: important reliability/quality requirement.
- **P2**: useful maturity/integration requirement.

## P0 gaps

No open P0 gaps.

## P1 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-007 | PRD-S18, PRD-P03 | Budget/watchdog enforcement now covers state-backed hard gates for context-token estimates, spawned agents, validation loops, storage scans, research reports, tools, debug attempts, wall time, and checkpoints, but provider-native token/cost accounting and user-facing configuration are still missing. | Add budget configuration/status commands and provider-native token/cost usage ingestion when available. |
| GAP-009 | PRD-S21..S24, PRD-W06..W07 | Validation gates need richer software and non-software support. | Add typed validation categories, non-software checklists, acceptance evidence fields, and stronger manifest defaults. |
| GAP-010 | PRD-S26, PRD-S27 | Safety/security/sandbox controls are partial. | Add internet/deploy/publish/secret gates, sandbox-mode metadata, and optional dependency/image scanner commands. |
| GAP-011 | PRD-S17 | `.scaler/` storage management missing. | Add storage usage scan, retention policy, report rotation, memory indexing, and hard pause on limits. |
| GAP-012 | PRD-S08, PRD-S09, PRD-P04 | Tool/MCP isolation needs deeper implementation. | Add tool catalog builder, tool-agent result schema, and focused tool transaction execution records. |
| GAP-019 | PRD-S06, PRD-W03 | Focused research-agent prompts and structured ingestion exist, but browser/MCP internet research execution is not automated. | Add explicit internet research tool policy, optional browser/MCP tool grants, and source capture for web research runs. |
| GAP-022 | PRD-G04, PRD-S19, PRD-S20, PRD-S25, PRD-W08 | Debug ledgers, hidden-cycle detection, focused debug-agent reports, research-request escalation, and replan escalation exist, but SCALER does not yet automatically run a bounded validation-failure → debug-agent → research-agent → replanner loop. | Add a deterministic debug conductor that starts after validation failure, runs exact-failure debugging, invokes research when a debug report requests it, retries only with accepted next approaches/new evidence, and requests replanning only after debug/research exhaustion. |

## P2 gaps

| Gap ID | Related requirements | Gap | Suggested next implementation slice |
|---|---|---|---|
| GAP-013 | PRD-S03 | Adaptive orchestration only selects a starting stage. | Add escalation/de-escalation rules driven by validation failures, uncertainty, risk, and budgets. |
| GAP-014 | PRD-S14, PRD-W05 | Task-agent run/report lifecycle needs tightening. | Require report ingestion from executed child agents before validation and track missing/invalid reports. |
| GAP-015 | PRD-S15 | Atomic task size is documented but not checked. | Add planner/task creation hints and optional warnings for tasks without DoD, validation, or allowed paths. |
| GAP-016 | PRD-S28 | Commit workflow lacks post-commit artifact/report. | Record commit id, task id, included paths, and validation summary in `.scaler/reports/commits.json`. |
| GAP-017 | PRD-S12, PRD-S13 | Memory retrieval is exact-id only. | Add tag/search filtering and summary references for task prompts. |
| GAP-018 | PRD-W04, PRD-S25, PRD-S31 | Execution plan artifacts can link tasks to PRD refs and create task records, but no planner agent writes/verifies full PRD coverage automatically. | Make future planner output create/update runtime PRD requirements, current execution plan tasks, task `prdRefs`, and coverage checks before execution. |
| GAP-020 | PRD-S02, PRD-S14, PRD-W05 | Full structured-report schemas exist for stage/replan/research/supervisor reports, but task-agent lifecycle still does not require a structured task completion report before validation. | Add task-agent `scaler_task_report` ingestion and require successful executed task agents to emit it before validation handoff. |
| GAP-021 | PRD-S11, PRD-P02 | Context split/externalization is currently prompt-guided by compression assessment, not automatically executed as a handoff workflow. | Add automatic context-split artifacts or fresh minimal-context task-agent spawning when resolved context remains over the active target after required refs are externalized. |

## Compliance review findings

Plan 035 source-spec review found that prior matrix entries for debugging overclaimed the full behavior described in `assignement.md` and `specs/attempt-tracking.md`. IMPL-138..140 added hidden-cycle detection, debug reports, and focused debug-agent escalation. IMPL-142..153 added split mocked/real integration coverage for the current manual validation-failure → debug report → research request/report → next approach path, staged artifact advancement, preservation-gated replan acceptance, debug/validation-triggered replanning, unsafe proposal rejection, budget/context/lock/safety/research/dependency/commit chains, structured-only rejection, opt-in real Pi structured-output contracts with exact Pi `--mode json` wrapper extraction, and validated-task git commits, but the remaining automatic debug/research/replan conductor loop is tracked as GAP-022. Existing major misses remain visible above: internet/browser/MCP research execution, storage management, CI/CD/sandbox validation, non-software validation, task-agent report enforcement, and automatic context split/externalization.

## Closure rule

A gap can be closed only when:

1. The implementation is committed under an IMPL task.
2. Relevant tests pass and are committed.
3. Manual docs describe only implemented behavior.
4. `traceability-matrix.md` and this backlog are updated in the same task or immediately following traceability task.
5. Review includes `assignement.md` and relevant `specs/*.md`, not only the PRD matrix artifacts.
