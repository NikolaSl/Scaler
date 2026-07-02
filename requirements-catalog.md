# SCALER Requirements Catalog

Stable requirement IDs derived from `assignement.md`. Keep this file compact and update it when the PRD changes.

Status/coverage is tracked in `traceability-matrix.md`; this file only defines requirements.

## Problem statements

| ID | PRD statement | Spec/reference |
|---|---|---|
| PRD-P01 | Avoid distraction from excessive or unrelated active context. | `assignement.md` I |
| PRD-P02 | Avoid amnesia and detail loss caused by repeated compression. | `assignement.md` I |
| PRD-P03 | Reduce token/cost growth from single-agent context accumulation. | `assignement.md` I |
| PRD-P04 | Reduce MCP/tool context cost and tool-use hallucination risk. | `assignement.md` I |
| PRD-P05 | Keep tasks narrow so failures are easier to isolate and debug. | `assignement.md` I |
| PRD-P06 | Prevent repeated non-working fixes and cyclic debugging. | `assignement.md` I |

## Goals

| ID | PRD statement | Spec/reference |
|---|---|---|
| PRD-G01 | Build a Pi-Agent architecture for larger problems with fewer context, focus, and cost issues. | `assignement.md` II |
| PRD-G02 | Each agent call should be focused and use only information needed for the immediate task. | `assignement.md` II |
| PRD-G03 | Tasks should be atomic, iterative, and validated. | `assignement.md` II |
| PRD-G04 | Problems should be detected and debugged as early as possible. | `assignement.md` II |

## Solution requirements

| ID | PRD statement | Spec/reference |
|---|---|---|
| PRD-S01 | Provide a deterministic non-LLM supervisor/state machine around all agents. | `specs/supervisor.md` |
| PRD-S02 | Supervisor reads structured reports, validates fields, persists state, and controls transitions. | `specs/supervisor.md` |
| PRD-S03 | Use the lightest reliable orchestration and escalate complexity only when needed. | `specs/adaptive-orchestration.md` |
| PRD-S04 | Resolve active context per task from manifests, latest validated state, memory refs, file state, and validation needs. | `specs/context-selection.md` |
| PRD-S05 | Task agents must request missing data instead of guessing. | `specs/context-selection.md`, `specs/task-agents.md` |
| PRD-S06 | Support local/internet research with source quality, contradiction handling, confidence, and completeness criteria. | `specs/research.md` |
| PRD-S07 | Keep raw research outside active context and preserve concise conclusions/evidence references. | `specs/research.md`, `specs/memory.md` |
| PRD-S08 | Optimize tool/MCP usage with short catalogs and isolated tool agents receiving only requested tool context. | `specs/tool-mcp-safety.md` |
| PRD-S09 | Tool agents execute focused tool transactions and return concise reports. | `specs/tool-mcp-safety.md` |
| PRD-S10 | Compression should discard no-longer-needed data while preserving exact information where exactness matters. | `assignement.md` III.6 |
| PRD-S11 | If compressed context remains over budget, split work, externalize data, and spawn fresh minimal-context agents. | `assignement.md` III.6 |
| PRD-S12 | Store useful-but-inactive detail in `.scaler/memory/` and keep only short active references. | `specs/memory.md` |
| PRD-S13 | Retrieve only requested useful memory content when needed. | `specs/memory.md` |
| PRD-S14 | Spawn dedicated task agents for atomic tasks with narrow scope, minimal context, allowed tools, validation, and structured reports. | `specs/task-agents.md` |
| PRD-S15 | Atomic tasks are the smallest useful independently checkable units, not wastefully tiny. | `specs/task-agents.md` |
| PRD-S16 | Preserve a structured audit trail of logs, tool calls, validation, state transitions, prompts, and reports. | `specs/logging.md` |
| PRD-S17 | Manage `.scaler/` storage with limits, compression/rotation/indexing, and pause rules. | `specs/storage.md` |
| PRD-S18 | Enforce budgets/watchdogs for tokens, cost, tools, agents, time, storage, debug attempts, research, and validation loops. | `specs/budgets-watchdogs.md` |
| PRD-S19 | Track failures and debug attempts with hypotheses, actions, validation results, evidence, and log references. | `specs/attempt-tracking.md` |
| PRD-S20 | Detect repeated attempts/cycles and prevent continuing the same failed approach without new evidence. | `specs/attempt-tracking.md` |
| PRD-S21 | Require validation gates before a task is complete and supervisor-accepted. | `specs/validation.md` |
| PRD-S22 | Use strongest practical software gates: dependencies, test-first checks, build, unit/integration/static/acceptance tests. | `specs/validation.md` |
| PRD-S23 | Support local CI/CD validation environments such as Docker, dev containers, Compose, Minikube, or sandboxes when needed. | `specs/cicd-environment.md` |
| PRD-S24 | Validate non-software tasks for completeness, consistency, compliance, sources, adversarial questions, and uncertainty. | `specs/validation.md` |
| PRD-S25 | Replan based on execution evidence while preserving validated progress. | `specs/replanning.md` |
| PRD-S26 | Enforce deterministic safety gates for risky actions, protected paths, secrets, internet, deployment, publishing, and destructive operations. | `specs/safety-permissions.md` |
| PRD-S27 | Prefer controlled sandboxes for unattended risky work and scan dependencies/images where tools are available. | `specs/safety-permissions.md`, `specs/cicd-environment.md` |
| PRD-S28 | Commit each validated task with task id and avoid unrelated user changes, secrets, and runtime artifacts. | `specs/git-workflow.md` |
| PRD-S29 | Implement SCALER as a Pi extension using commands, structured tools, hooks, subprocess agents, `.scaler/` state, and deterministic supervisor logic. | `specs/pi-extension-architecture.md` |
| PRD-S30 | Enforce mandatory sequential work per repo to avoid collisions and stale analysis. | User decision; `manual/sequential-execution.md` |

## Stage workflow requirements

| ID | PRD statement | Spec/reference |
|---|---|---|
| PRD-W01 | For complex requests, solve work through staged conductor loop rather than direct execution. | `assignement.md` III.18 |
| PRD-W02 | Stage I: PRD agent reviews, clarifies, polishes, and writes `agent-prd.md`. | `assignement.md` III.18 |
| PRD-W03 | Stage II: knowledge agent collects reliable local/internet knowledge, resolves contradictions, and writes a knowledge report. | `assignement.md` III.18 |
| PRD-W04 | Stage III: planner creates a detailed sequential atomic execution plan linked to PRD/knowledge and Definition of Done. | `assignement.md` III.18 |
| PRD-W05 | Stage IV: execute tasks sequentially with one atomic task agent per task. | `assignement.md` III.18 |
| PRD-W06 | Software execution should update/write tests, implement, validate dependencies, build/compile, and run tests/acceptance checks. | `assignement.md` III.18 |
| PRD-W07 | Non-software execution should validate logical completeness, consistency, compliance, adversarial questions, and evidence. | `assignement.md` III.18 |
| PRD-W08 | Execution discoveries can pause execution, update Stage II/III outputs, create a new plan version, and continue while preserving validated progress. | `assignement.md` III.18 |
