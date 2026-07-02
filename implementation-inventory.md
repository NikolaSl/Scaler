# SCALER Implementation Inventory

Maintenance artifact for `traceability-matrix.md`. Update when implementation plans add or change requirement coverage.

## Plan and implementation task inventory

| Task range | Theme | Key commits/tasks | Main code paths | Tests | Manuals/docs |
|---|---|---|---|---|---|
| IMPL-001..005 | Extension, state, supervisor foundation | Initial extension/state/FSM tasks | `src/index.ts`, `src/state.ts`, `src/supervisor.ts`, `src/types.ts` | `test/extension-shape.test.ts`, `test/state.test.ts`, `test/supervisor.test.ts` | `manual/state.md`, `manual/installation.md` |
| IMPL-006..010 | Logging, memory, context, adaptive basics | Logging/memory/context/adaptive tasks | `src/logging.ts`, `src/memory.ts`, `src/context.ts`, `src/adaptive.ts`, `src/paths.ts` | `test/logging.test.ts`, `test/memory.test.ts`, `test/context.test.ts`, `test/adaptive.test.ts` | `manual/logging.md`, `manual/memory.md`, `manual/context.md` |
| IMPL-011..015 | Reports, validation reports, task creation, status | Structured reports and status | `src/reports.ts`, `src/validation.ts`, `src/tasks.ts`, `src/state.ts`, `src/tools.ts` | `test/reports.test.ts`, `test/validation.test.ts`, `test/tasks.test.ts`, `test/tools.test.ts`, `test/state.test.ts` | `manual/tools.md`, `manual/commands.md`, `manual/state.md` |
| IMPL-016..020 | Lifecycle helpers, budgets, git skeleton/status | Task lifecycle/budget/git helpers | `src/budgets.ts`, `src/checkpoints.ts`, `src/git.ts`, `src/tasks.ts`, `src/state.ts` | `test/budgets.test.ts`, `test/git.test.ts`, `test/tasks.test.ts` | `manual/budgets.md`, `manual/git.md` |
| IMPL-021..025 | Tool request and safety foundations | Tool/MCP request and safety | `src/safety.ts`, `src/tool-requests.ts`, `src/tools.ts` | `test/safety.test.ts`, `test/tool-requests.test.ts`, `test/tools.test.ts` | `manual/safety.md`, `manual/tools.md` |
| IMPL-026..030 | Validation runner and git commit helper | Validation manifests/runs and validated commits | `src/validation.ts`, `src/git.ts`, `src/index.ts` | `test/validation-manifest.test.ts`, `test/validation-runner.test.ts`, `test/git.test.ts`, `test/extension-shape.test.ts` | `manual/commands.md`, `manual/git.md` |
| IMPL-031..035 | Workflow command integration | Allowed paths, manifest tool, create/commit/list commands | `src/commands.ts`, `src/conductor.ts`, `src/index.ts`, `src/tasks.ts`, `src/tools.ts`, `src/types.ts` | `test/commands.test.ts`, `test/conductor.test.ts`, `test/tasks.test.ts`, `test/tools.test.ts`, `test/extension-shape.test.ts` | `manual/commands.md`, `manual/tools.md` |
| IMPL-036..040 | Workflow operability and sequencing | Status summary, dependencies, task update, validation-add, workflow manual | `src/workflow.ts`, `src/conductor.ts`, `src/tasks.ts`, `src/commands.ts`, `src/index.ts`, `src/validation.ts`, `src/tools.ts` | `test/workflow.test.ts`, `test/conductor.test.ts`, `test/tasks.test.ts`, `test/commands.test.ts`, `test/validation-manifest.test.ts` | `manual/workflow.md`, `manual/commands.md`, `manual/index.md` |
| IMPL-041..045 | Safety and context hardening | Protected bash paths, allowed-path safety, safety prompt, omitted context docs | `src/safety.ts`, `src/index.ts`, `src/conductor.ts`, `src/context.ts` | `test/safety.test.ts`, `test/conductor.test.ts`, `test/context.test.ts` | `manual/safety.md`, `manual/context.md`, `manual/index.md` |
| IMPL-046..050 | Execution reliability | Task-agent run records, timeout/abort diagnostics, retry, runs command | `src/conductor.ts`, `src/subagents.ts`, `src/tasks.ts`, `src/commands.ts`, `src/index.ts`, `src/paths.ts` | `test/conductor.test.ts`, `test/subagents.test.ts`, `test/spawn-tool.test.ts`, `test/tasks.test.ts`, `test/commands.test.ts` | `manual/task-agents.md`, `manual/commands.md`, `manual/workflow.md` |
| IMPL-051..055 | Mandatory sequential execution | Execution lock model/enforcement/commands/docs | `src/locks.ts`, `src/operations.ts`, `src/conductor.ts`, `src/tools.ts`, `src/index.ts`, `src/paths.ts` | `test/locks.test.ts`, `test/operations.test.ts`, `test/conductor.test.ts`, `test/spawn-tool.test.ts`, `test/extension-shape.test.ts` | `manual/sequential-execution.md`, `manual/commands.md`, `manual/task-agents.md`, `manual/tools.md`, `manual/workflow.md` |
| IMPL-056 | Requirement catalog | Stable PRD IDs | `requirements-catalog.md` | n/a | `requirements-catalog.md` |
| IMPL-057..060 | Traceability maintenance | Inventory, matrix, gap backlog, maintenance rule | `implementation-inventory.md`, `traceability-matrix.md`, `gap-backlog.md`, `plans/implementation-plan.md` | n/a | `manual/index.md` |
| IMPL-061..066 | Runtime PRD ledger | Runtime polished PRD storage, task PRD refs, coverage summary, PRD commands/tools/docs, normative assignment/spec coverage | `src/prd.ts`, `src/tasks.ts`, `src/commands.ts`, `src/index.ts`, `src/tools.ts`, `src/paths.ts`, `src/types.ts`, `specs/runtime-prd-ledger.md` | `test/prd.test.ts`, `test/tasks.test.ts`, `test/commands.test.ts`, `test/tools.test.ts`, `test/extension-shape.test.ts` | `manual/runtime-prd.md`, `manual/commands.md`, `manual/tools.md`, `manual/workflow.md`, `requirements-catalog.md`, `traceability-matrix.md` |

## Current high-value code areas

| Area | Code | Purpose |
|---|---|---|
| Extension commands/hooks | `src/index.ts` | Pi command registration and safety hook. |
| Deterministic state/FSM | `src/state.ts`, `src/supervisor.ts`, `src/types.ts` | Persistent state and valid transitions. |
| Task orchestration | `src/conductor.ts`, `src/tasks.ts`, `src/subagents.ts` | Task selection, prompts, subprocess agents, run records, and runtime PRD refs. |
| Sequential locking | `src/locks.ts`, `src/operations.ts` | Single-operation lock and locked validation/commit wrappers. |
| Validation | `src/validation.ts` | Validation manifests, command runner, validation reports. |
| Git progress | `src/git.ts` | Dirty-tree classification and validated task commits. |
| Safety | `src/safety.ts` | Protected paths, destructive commands, allowed path enforcement. |
| External memory/logging | `src/memory.ts`, `src/logging.ts` | Memory files and JSONL audit log. |
| Context | `src/context.ts` | Minimal context resolver and omitted-context summaries. |
| Runtime PRD ledger | `src/prd.ts` | Per-run polished PRD files, requirement catalog, coverage computation, snapshots, and change log. |
| Tool isolation | `src/tool-requests.ts`, `src/tools.ts` | Structured tools and isolated tool requests. |

## Maintenance rule

When a future implementation task changes requirement coverage, update:

1. `implementation-inventory.md`
2. `traceability-matrix.md`
3. `gap-backlog.md` when the change closes, adds, or reprioritizes a gap
