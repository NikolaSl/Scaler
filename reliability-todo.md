# SCALER Reliability TODO

## 1. Execution supervisor

- Define deterministic stage/task state machine.
- Track current stage, current task, task status, validation state, and escalation state.

## 2. Context selection

- Define required inputs per task before execution.
- Add context size limits and relevance rules.
- Require missing-context reports instead of guessing.

## 3. External memory

- Define `memory/` structure and memory index.
- Add metadata: topic, source, related task, validity, created time, stale/obsolete state.
- Add retrieval limits and relevance justification.

## 4. Loop and attempt tracking

- Persist attempted fixes per task.
- Detect repeated or cyclic approaches.
- Force new investigation/approach when a loop is detected.

## 5. Validation gates

- Define software validation gates: build, dependencies, unit tests, integration tests, acceptance tests where possible.
- Define intellectual validation gates: consistency, completeness, compliance, source checks, adversarial questions.

## 6. Replanning protocol

- Define when execution pauses for Stage II/III update.
- Pass current execution state to planner: completed validated tasks, failed task, attempts, changed files, remaining tasks.

## 7. Budgets and watchdogs

- Add token, cost, tool-call, agent-count, and wall-clock limits.
- Add task timeout and stuck-agent detection.
- Add checkpoint/resume behavior.

## 8. Tool/MCP safety

- Require schema/help inspection when usage is uncertain.
- Prefer dry-run for risky tools when possible.
- Log exact tool request, command, result, and failure.

## 9. Safety and permissions

- Define protected paths and destructive-action policy.
- Define internet/search policy and secret handling.
- Define approval gates for deployment, publishing, deletion, and sensitive operations.
