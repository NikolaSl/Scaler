# SCALER Reliability TODO

## 1. Execution supervisor

Status: defined in `specs/supervisor.md`.

- [x] Define deterministic stage/task state machine.
- [x] Track current stage, current task, task status, validation state, and escalation state.
- [x] Define valid transitions and triggers.
- [x] Define rejected transition behavior.
- [x] Define minimal persistent state.

## 2. Context selection

Status: defined in `specs/context-selection.md`.

- [x] Define required inputs per task before execution.
- [x] Add context size limits and relevance rules.
- [x] Require missing-context reports instead of guessing.
- [x] Define multi-stage context selection flow.
- [x] Define pre-spawn context resolver.
- [x] Define RAG/search policy.

## 3. External memory

Status: draft defined in `specs/memory.md`.

- [x] Define `memory/` structure and memory index.
- [x] Add metadata: topic, source, related task, validity, created time, stale/obsolete state.
- [x] Add retrieval limits and relevance justification.

## 4. Loop and attempt tracking

Status: defined in `specs/attempt-tracking.md`.

- [x] Persist attempted fixes per task.
- [x] Detect repeated or cyclic approaches.
- [x] Force new investigation/approach when a loop is detected.
- [x] Define failure fingerprints and attempt signatures.
- [x] Define token-control rules during debugging.
- [x] Define escalation to replanning.

## 5. Validation gates

Status: defined in `specs/validation.md`.

- [x] Define software validation gates: build, dependencies, unit tests, integration tests, acceptance tests where possible.
- [x] Define intellectual validation gates: consistency, completeness, compliance, source checks, adversarial questions.
- [x] Define validation manifest and report format.
- [x] Define failure behavior and debug handoff.
- [x] Define environment limitation handling.

## 6. Replanning protocol

Status: defined in `specs/replanning.md`.

- [x] Define when execution pauses for Stage II/III update.
- [x] Pass current execution state to planner: completed validated tasks, failed task, attempts, changed files, remaining tasks.
- [x] Define plan versioning.
- [x] Define replanning input/output package.
- [x] Define POC handling.
- [x] Define progress preservation rules.

## 7. Budgets and watchdogs

Status: defined in `specs/budgets-watchdogs.md`.

- [x] Add token, cost, tool-call, agent-count, wall-clock, and storage limits.
- [x] Add task timeout and stuck-agent detection.
- [x] Add checkpoint/resume behavior.
- [x] Define soft/hard limit behavior.
- [x] Define heartbeat/progress watchdogs.
- [x] Define budget/watchdog reports.

## 8. Tool/MCP safety

Status: defined in `specs/tool-mcp-safety.md`.

- [x] Require schema/help inspection when usage is uncertain.
- [x] Prefer dry-run for risky tools when possible.
- [x] Log exact tool request, command, result, and failure.
- [x] Define structured tool request format.
- [x] Define isolated tool-agent execution.
- [x] Define multiple/parallel tool request behavior.

## 9. Safety and permissions

Status: defined in `specs/safety-permissions.md`.

- [x] Define protected paths and destructive-action policy.
- [x] Define internet/search policy and secret handling.
- [x] Define approval gates for deployment, publishing, deletion, and sensitive operations.
- [x] Define risk levels and agent permission manifest.
- [x] Define secure-development rules.
- [x] Define dependency/container CVE scanning requirements.
- [x] Define sandboxed execution and exception rules.

## 10. Logging and audit trail

Status: draft defined in `specs/logging.md`.

- [x] Define structured append-only event log.
- [x] Define logging of state transitions, agents, tools, memory, validation, debugging, and decisions.
- [x] Define rule for cleaning active context while preserving raw steps in logs.

## 11. Storage management

Status: draft defined in `specs/storage.md`.

- [x] Define `.scaler/` storage scope.
- [x] Define configurable soft/hard storage limits.
- [x] Define compression, rotation, retention, and pause rules.
- [x] Define large output handling and deduplication direction.

## 12. Git progress tracking

Status: draft defined in `specs/git-workflow.md`.

- [x] Define repository setup rule.
- [x] Define per-task commit rule and message format.
- [x] Define dirty-tree/unrelated-changes handling.
- [x] Define runtime data commit exclusions.

## 13. Local CI/CD environments

Status: draft defined in `specs/cicd-environment.md`.

- [x] Define Docker/dev-container/Compose/Minikube usage.
- [x] Define planning requirements for local CI/CD validation.
- [x] Define execution and validation reporting rules.
- [x] Define security requirements for local CI/CD environments.
- [x] Define sandbox safety model for unattended execution.

## 14. Research and information quality

Status: draft defined in `specs/research.md`.

- [x] Define local/internet research mechanisms.
- [x] Define source quality ranking and signal/noise criteria.
- [x] Define information completeness criteria.
- [x] Define research report format.
- [x] Define deep research triggers.
- [x] Define on-demand research-agent usage.

## 15. Adaptive orchestration

Status: draft defined in `specs/adaptive-orchestration.md`.

- [x] Define proportional complexity levels.
- [x] Define escalation and de-escalation rules.
- [x] Define when to avoid unnecessary agent spawning.
- [x] Define on-demand research and validation scaling.
