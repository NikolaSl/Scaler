# SCALER Task Agents Spec

## Purpose

Task agents are temporary agents spawned for one atomic task when isolation is useful.

For simple tasks, Scaler may execute directly or with a lighter process according to `specs/adaptive-orchestration.md`.

Atomic means the smallest useful consistent task that can be completed, compiled/checked, and tested independently after completion. It must not depend on other planned tasks that are not completed yet.

Atomic does not mean line-by-line or mechanically minimal. Trivial related changes can be grouped when they share the same purpose, validation, and risk profile. The goal is to minimize errors and simplify debugging without creating wasteful execution cycles.

Scaler should not depend on fixed predefined roles. The conductor/planner can generate a custom role, prompt, tool set, and context for each task.

Predefined prompts may be used as templates, but the final task-agent prompt should be adapted and polished for the exact task.

## Common task-agent contract

Every task agent must follow the same contract:

- Work only on the assigned atomic task.
- Keep the task independently completable and testable.
- Do not depend on not-yet-completed tasks.
- Use only context selected by the context resolver, retrieved memories, and allowed tools.
- Request missing data instead of guessing.
- Investigate local data, and internet sources when allowed, if needed for the task.
- Keep only conclusions and active evidence in context after investigation.
- Keep large non-active details in external memory.
- Preserve raw investigation/debug steps in logs.
- Produce a structured report to the caller.
- Follow the supervisor FSM states and validation rules from `specs/validation.md`.

## Task sizing rules

Split a task when:

- It mixes unrelated goals or concerns.
- Parts can fail independently and need different debugging paths.
- Parts require different context, tools, or validation.
- The change is risky enough that smaller validation steps reduce uncertainty.
- It depends on information that is not yet known.

Group changes when:

- They are trivial and tightly related.
- They share the same implementation intent.
- They share the same validation commands/checks.
- Splitting would add orchestration cost without improving debugging or reliability.

## Agent creation inputs

A task-agent spawn request should be prepared after the pre-spawn context resolver defined in `specs/context-selection.md`.

It should include:

- task id
- task goal
- generated role
- required inputs/references
- memory references
- allowed tools
- permission manifest
- constraints
- expected output
- Definition of Done
- validation commands/checks
- budget/timeout limits
- reporting format

## Prompt generation

The prompt should define:

- who the agent is for this task
- exact task scope
- what is out of scope
- available inputs, tools, and permissions
- expected output
- validation requirements and validation gates
- missing-data behavior
- investigation behavior
- debug behavior according to `specs/attempt-tracking.md`
- logging requirements
- final report format

## Tool selection

Tools should be assigned on demand per task.

Default rule: give the smallest useful tool set. Avoid exposing unrelated tools because they increase distraction, risk, and token cost.

Tool/MCP execution follows `specs/tool-mcp-safety.md`: task agents request tools through structured requests, and isolated tool agents handle detailed tool usage when needed.

## Isolation

Task agents should not freely chat with each other. They communicate through reports, memory files, and the conductor/supervisor.

This prevents agent collisions, context pollution, and uncontrolled delegation.

## Report

A task-agent report should include:

- task id
- status: `completed`, `needs_data`, `blocked`, `failed`, `needs_replan`
- summary
- outputs/artifacts
- changed files, if any
- memories created or retrieved
- validations run and results
- validation report references
- git commit hash or skipped-commit reason
- investigation summary and evidence references
- debug attempts and failure fingerprints, if any
- log references for important decisions
- missing data or blockers
- recommended next action
