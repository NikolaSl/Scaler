# SCALER Adaptive Orchestration Spec

## Purpose

Scaler must not use heavy orchestration for simple tasks.

The system should scale its process, agents, validation, research, and safety mechanisms according to task complexity and risk.

## Principle

Use the lightest reliable process that can satisfy the request.

Scaler should behave like an intelligent scientist, manager, architect, and engineer: simple work stays simple; complex work gets the structure needed to solve it safely.

## Complexity levels

### Level 0: Direct response

Use when the request is simple, informational, low-risk, and does not require project changes.

No Stage I-IV workflow is needed.

### Level 1: Simple task

Use when the task is clear, small, and low-risk.

May use:

- minimal context selection
- one task agent or direct execution
- basic validation
- short report

### Level 2: Standard task

Use when project changes, tests, or moderate investigation are needed.

Use:

- compact PRD clarification if needed
- context manifest
- task agent
- validation gates
- git commit when files change

### Level 3: Complex task

Use when the task requires planning, multiple tasks, research, dependencies, or CI/CD setup.

Use:

- Stage I PRD polishing
- Stage II research/knowledge collection
- Stage III planning
- Stage IV sequential execution
- supervisor state
- memory/logging
- validation gates
- replanning when needed

### Level 4: High-risk or large-scale task

Use when the task is long-running, security-sensitive, production-like, unclear, or has high failure cost.

Use full Scaler controls:

- separate research agents when useful
- deeper validation
- sandbox/CI/CD environment
- budgets/watchdogs
- safety approvals
- stronger audit trail
- plan versioning and POC tasks

## Escalation

Scaler may escalate to a higher level when:

- requirements are unclear
- missing knowledge blocks progress
- validation fails
- risk is higher than expected
- task scope grows
- plan assumptions fail
- a POC or sandbox is needed

## De-escalation

Scaler should avoid unnecessary work and de-escalate when:

- the task is already clear
- local evidence is sufficient
- no project changes are needed
- risk is low
- validation can be simple
- extra agents would not improve reliability

## Agent spawning rule

Spawn agents only when isolation improves focus, reliability, speed, or safety.

Do not spawn separate agents for trivial subtasks, obvious file reads, or tiny related changes.

## Research rule

Use separate research agents only when the research question is non-trivial, independent, or large enough that isolation improves quality.

Simple lookups can be handled by the current task agent or coordinator.

## Validation rule

Use the strongest practical validation, but do not run expensive validation that does not improve confidence for the current task.

## Supervisor behavior

The supervisor should record selected complexity level and escalation/de-escalation reasons.

The level can change during execution based on evidence.

Budget sizes and watchdog strictness should follow `specs/budgets-watchdogs.md` and scale with the selected complexity level.
