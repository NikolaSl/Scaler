# SCALER Manual

This manual documents implemented Scaler behavior.

Design requirements live in `assignement.md` and `specs/`. Compliance reviews must read those source requirements alongside `requirements-catalog.md`, `traceability-matrix.md`, and this manual; the matrix is a tracking view, not the only source of truth. This manual stays aligned with code that actually exists.

## Current implemented behavior

- Pi extension entrypoint: `src/index.ts`.
- Commands include the supervisor/task/stage/debug/research/replan/tool/storage/safety/watchdog/budget/git workflow plus validation commands such as `/scaler-validation-add`, `/scaler-validation-envs`, `/scaler-cicd-env`, `/scaler-cicd-envs`, `/scaler-validate-loop`, and `/scaler-validate`; see `manual/commands.md` for the current full command reference.
- State file: `.scaler/state.json`.
- Basic deterministic supervisor transition helpers.
- Audit log: `.scaler/logs/events.jsonl` with redacted detail payload files under `.scaler/logs/details/` for commands, prompts, tools, reports, validation summaries, and commits, plus `.scaler/logs/tools/` references for oversized Pi tool results.
- Deterministic safety gate for protected paths, destructive shell commands, protected-path shell access, and current-task allowed paths.
- Experimental task-agent subprocess invocation builder with required structured `scaler_task_report` handoff gating before validation.
- Structured Scaler tool skeletons registered with Pi, compact parent-session tool catalogs, and active-tool focus/restore for SCALER-guided requester turns.
- External memory write/search/retrieve under `.scaler/memory/` with tags, summary references, and scoped retrieval.
- Storage inventory indexes under `.scaler/storage/index.json` via `/scaler-storage-status`, coupled to the `storageBytes` budget gate.
- Research request/report ledgers under `.scaler/research/` with source quality, confidence, contradictions, raw evidence storage in memory, and focused research-agent run records/structured ingestion.
- Task context manifests under `.scaler/context/tasks/` with file, summary-scoped memory, state, task, PRD ref, validation-manifest resolution, exactness metadata, compression guidance, automatic split artifacts for oversized resolved context, deterministic externalization of large exact/summary-ok items, SCALER-aware compaction/context hooks, fresh minimal-context handoffs, semantic-style candidate curation/approval commands, and relevance discovery from changed files, plans, PRD coverage, validation history, and memory/tag matches.
- Minimal adaptive `/scaler` entrypoint.
- Budget usage helpers, scoped budget policies, complexity-level budget approval rules, and hard-limit gates for tools, spawned agents, debug attempts, context-token estimates, validation loops, storage scans, research reports, wall-clock time, and checkpoints.
- Watchdog ledgers under `.scaler/watchdogs/` for progress heartbeats, no-progress/replanning triggers, subprocess cleanup evidence, and resume verification.
- Checkpoint writing under `.scaler/checkpoints/` for pause/resume, watchdog pause, and conductor steps.
- Minimal one-step conductor execution with validation handoff artifacts and a debug retry gate for unresolved repeated failed fingerprints.
- Debug failure/attempt/report ledgers, longer hidden fingerprint-cycle detection, and a focused debug-agent workflow that emits structured `scaler_debug_report` events; reports can create research requests or debug-blocked replan requests.
- Deterministic validation manifests, command-run records, validation environment lifecycle records, and generated CI/CD sandbox/local-CI wrapper records under `.scaler/reports/cicd-environments.json` plus generated files under `.scaler/cicd/`.
- Git bootstrap/status records, pre-task dirty-tree checkpoints, commit/skip acceptance evidence, and post-commit reports.
- Implemented create/list/step/validate/commit workflow, including enforced task-definition quality for user-facing/planner task creation and explicit waivers for missing DoD, validation, allowed paths, atomicity, or test-first coverage.
- Task-agent run records with timeout/abort diagnostics and task-agent report ledgers under `.scaler/reports/task-agent-reports.json`.
- Mandatory repo-wide sequential execution lock for SCALER operations.
- Runtime PRD ledger under `.scaler/prd/` with requirement coverage summaries, task links, and structured planner-output synchronization.
- Versioned execution plan artifacts under `.scaler/plans/` with task application, planner coverage reports, replan request, focused replanner-agent proposal generation, preservation-check, and proposal acceptance helpers.
- Stage I-IV artifact records under `.scaler/stages/` with status commands, focused stage-agent preparation/runs, structured ingestion, one-step and bounded multi-step stage conductors, readiness/semantic/consistency validation, advancement, and workflow recommendations.
- Development traceability artifacts for requirement IDs, implementation inventory, matrix coverage, and gap backlog.
- Integration test harness with deterministic mock child-agent runners and optional real Pi/model execution guarded by cardinal structured-output instructions.

## Manual pages

- `manual/state.md`
- `manual/workflow.md`
- `manual/runtime-prd.md`
- `manual/execution-plans.md`
- `manual/debugging.md`
- `manual/research.md`
- `manual/stages.md`
- `manual/sequential-execution.md`
- `manual/commands.md`
- `manual/context.md`
- `manual/logging.md`
- `manual/memory.md`
- `manual/storage.md`
- `manual/safety.md`
- `manual/task-agents.md`
- `manual/tools.md`
- `manual/budgets.md`
- `manual/git.md`
- `manual/testing.md`
- `manual/installation.md`

## Development

Run checks:

```bash
npm test
npm run build
```

See `manual/testing.md` for mock integration tests and optional real Pi/model integration mode.

Traceability artifacts:

- `requirements-catalog.md` defines stable PRD requirement IDs.
- `implementation-inventory.md` maps implementation task ranges to code/tests/manuals.
- `traceability-matrix.md` maps PRD IDs to coverage status and next actions.
- `gap-backlog.md` tracks uncovered or partial requirements.

Future implementation plans/tasks must update these artifacts when requirement coverage changes. Coverage review must consult `assignement.md` and relevant `specs/*.md` source requirements as well as the PRD catalog/matrix.

## `/scaler-status`

Creates/loads `.scaler/state.json` and shows compact supervisor status.
