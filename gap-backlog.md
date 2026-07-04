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
| GAP-007 | PRD-S18, PRD-P03 | Budget/watchdog enforcement now covers state-backed hard gates for context-token estimates, spawned agents, validation loops, storage scans, research reports, tools, debug attempts, wall time, and checkpoints, plus user-facing `/scaler-budget-status` and `/scaler-budget-set` commands with mocked and opt-in real Pi command coverage. Provider-native token/cost accounting is still missing. | Add provider-native token/cost usage ingestion when Pi/model APIs expose reliable usage data, and map it into `contextTokens`/`estimatedCostMicros` budget counters. |
| GAP-009 | PRD-S21..S24, PRD-W06..W07 | Validation gates now support typed gate metadata, expected results, evidence refs, stronger package-script defaults, mocked validation-run/audit coverage, and opt-in real Pi command persistence. Remaining gaps: non-software checklist adjudication, richer acceptance evidence rules, dependency/test-first semantics, CI/sandbox execution, and blocked/skipped gate decisions. | Add deterministic non-software checklist validation records and acceptance evidence checks, then add CI/sandbox/dependency/test-first gate execution policy. |
| GAP-010 | PRD-S26, PRD-S27 | Safety/security/sandbox controls are partial. Protected-path, allowed-path, destructive-command, secret-environment, internet-transfer, deploy/publish, and remote-mutation blocking now have unit, mocked integration, and opt-in real Pi safety-hook coverage. Remaining gaps: approval workflows, persistent policy configuration, sandbox-mode metadata/execution, and optional dependency/image scanner commands. | Add approval/policy persistence, sandbox-mode metadata/execution controls, and optional dependency/image scanner commands. |
| GAP-011 | PRD-S17 | `.scaler/` storage management now has inventory scans, `.scaler/storage/index.json`, top-level/largest-file summaries, `/scaler-storage-status`, `storageBytes` budget updates, and hard-pause behavior with mocked/real command coverage. Remaining gaps: retention policy, log/report rotation, compression, cache cleanup, minimum-free-disk checks, and approval-based deletion of raw logs/memory. | Add retention/rotation/compression policy and safe cache cleanup, then minimum-free-disk checks. |
| GAP-012 | PRD-S08, PRD-S09, PRD-P04 | Tool/MCP isolation needs deeper implementation. | Add tool catalog builder, tool-agent result schema, and focused tool transaction execution records. |
| GAP-019 | PRD-S06, PRD-W03 | Focused research-agent prompts and structured ingestion exist, but browser/MCP internet research execution is not automated. | Add explicit internet research tool policy, optional browser/MCP tool grants, and source capture for web research runs. |
| GAP-022 | PRD-G04, PRD-S19, PRD-S20, PRD-S25, PRD-W08 | Debug ledgers, hidden-cycle detection, focused debug-agent reports, research-request escalation, replan escalation, opt-in real Pi flow-parity/remaining-flow coverage, bounded debug conductor, and explicit `/scaler-validate-loop` handoff now exist. Remaining work: execute/validate the accepted `next_approach`, safely retry only with new evidence or accepted replans, and optionally wire policy-driven auto-start where appropriate. | Add deterministic next-approach retry execution with exact failing validation first, preserve no-auto-replan-acceptance, and make any auto-start policy explicit/configurable. |

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

Plan 035 source-spec review found that prior matrix entries for debugging overclaimed the full behavior described in `assignement.md` and `specs/attempt-tracking.md`. IMPL-138..140 added hidden-cycle detection, debug reports, and focused debug-agent escalation. IMPL-142..153 added split mocked/real integration coverage for the current manual validation-failure → debug report → research request/report → next approach path, staged artifact advancement, preservation-gated replan acceptance, debug/validation-triggered replanning, unsafe proposal rejection, budget/context/lock/safety/research/dependency/commit chains, structured-only rejection, opt-in real Pi structured-output contracts with exact Pi `--mode json` wrapper extraction, and validated-task git commits. IMPL-154..156 added opt-in real Pi extension integrity coverage for extension loading, slash-command dispatch, cardinal SCALER tool execution, safety-hook blocking, audit logs, and persisted state. IMPL-157..160 added opt-in real Pi flow-parity chains for debug → research → next approach, Stage I-IV conductor advancement, and replanner proposal acceptance, with report-only child agents using `--no-tools`. IMPL-161..166 added additional opt-in real remaining-flow parity for non-debug free-form rejection, research raw-evidence memory/context, debug-blocked replan acceptance, unsafe replan rejection, and hardened cardinal-only negative prompts. IMPL-167..172 added the bounded debug conductor, `/scaler-debug-loop`, mocked validation-failure debug/research/replan conductor coverage, opt-in real Pi/model debug conductor coverage, and real cardinal-output hardening for the Stage I-IV parity test. IMPL-173..177 added `/scaler-validate-loop`, an explicit validation-first handoff into the bounded debug loop after failed validation, plus unit, mocked integration, and opt-in real Pi/model coverage. IMPL-178..182 added budget status/configuration commands, mocked command-configured hard-stop coverage, and opt-in real Pi command persistence coverage, narrowing GAP-007 to provider-native usage ingestion. IMPL-183..187 added typed validation gate metadata, stronger default package-script classification, mocked validation-run/audit coverage, and opt-in real Pi command persistence coverage, narrowing GAP-009 to checklist adjudication and richer gate execution/acceptance policies. IMPL-188..191 added external/internet/deploy/publish/secret-command safety gates with unit, mocked hook, and opt-in real Pi coverage, narrowing GAP-010 to approvals, persistent policy, sandbox, and scanner integration. IMPL-192..196 added `.scaler/` storage inventory/status indexing and storage hard-pause coverage, narrowing GAP-011 to retention/rotation/compression/cleanup/free-disk controls. The remaining automatic next-approach patch/retry work is tracked as GAP-022. Existing major misses remain visible above: internet/browser/MCP research execution, storage retention/rotation/compression, CI/CD/sandbox validation, non-software validation adjudication, task-agent report enforcement, and automatic context split/externalization.

## Closure rule

A gap can be closed only when:

1. The implementation is committed under an IMPL task.
2. Relevant tests pass and are committed.
3. Manual docs describe only implemented behavior.
4. `traceability-matrix.md` and this backlog are updated in the same task or immediately following traceability task.
5. Review includes `assignement.md` and relevant `specs/*.md`, not only the PRD matrix artifacts.
