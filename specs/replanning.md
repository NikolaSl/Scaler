# SCALER Replanning Protocol Spec

## Purpose

The initial plan is only the best plan available before empirical execution.

Even after PRD polishing and knowledge collection, execution can reveal missing facts, wrong assumptions, impossible tasks, better approaches, or the need for a proof of concept.

Scaler must treat planning as versioned and updateable, not final.

## Principle

The plan is expected to change.

Replanning must preserve validated progress and use real execution evidence. It must not restart from scratch unless explicitly required.

## Plan versions

Each execution plan should have a version id:

- `PLAN-001` — initial plan from Stage III.
- `PLAN-002+` — updated plans after execution evidence.

Each plan version should record:

- reason for creation
- source PRD/knowledge references
- execution state used as input
- changed tasks
- preserved tasks
- removed/replaced tasks
- new assumptions
- validation impact

## Replanning triggers

Execution should pause for replanning when:

- A task is impossible as defined.
- Required information is missing and cannot be resolved inside the task through research.
- Debug/research investigation cannot produce a working approach.
- Validation shows the plan assumptions are wrong.
- A proof of concept is needed before continuing safely.
- A completed task changes the best order, scope, or dependencies of future tasks.
- New knowledge invalidates future tasks.
- Safety, budget, storage, CI/CD, or environment limits require a different approach.

Do not replan for every small implementation detail. Task agents should handle local fixes inside the task loop when possible.

## Replanning input package

When replanning starts, the planner must receive:

- current PRD reference
- current knowledge/research report references
- current plan version
- completed and validated tasks
- commit hashes for completed tasks when available
- current task and failure/blocker
- attempt stack and debug findings
- changed files/artifacts
- created memories
- validation results
- remaining tasks
- known invalidated assumptions
- reason replanning is requested

## Replanning output

The planner should produce a new plan version with:

- preserved validated tasks
- updated remaining task list
- task dependency changes
- new or updated context manifests
- updated validation manifests
- updated CI/CD environment tasks when needed
- new POC tasks when needed
- removed/replaced tasks with reasons
- migration notes from old plan to new plan
- risks and assumptions

## POC handling

A POC is an execution task used to reduce uncertainty.

POC tasks should be:

- small and isolated
- clearly marked as `poc`
- validated by explicit success/failure criteria
- committed only if it becomes part of final project work or if configured
- converted into implementation tasks, discarded, or used to update the plan

## Preserving progress

Validated tasks are stable checkpoints.

Replanning must not modify or invalidate completed validated tasks unless there is clear evidence they are wrong. If validated work must be changed, the new plan must include an explicit corrective task.

## Supervisor behavior

During replanning:

1. Pause normal execution.
2. Store replanning reason and input package.
3. Spawn planner with current execution state.
4. Validate the new plan structure.
5. Preserve completed validated tasks.
6. Update remaining tasks and context manifests.
7. Resume execution from the next ready task.

## Replanning report

The replanning report should include:

- old plan version
- new plan version
- replanning reason
- evidence that triggered replanning
- completed validated tasks preserved
- tasks changed/added/removed
- POC tasks added, if any
- updated next task
- risks and assumptions

## Logging and git

Replanning events must be logged according to `specs/logging.md`.

If plan files are project artifacts, commit replanning updates according to `specs/git-workflow.md` with a message such as:

```text
PLAN-002: update plan after T-004 blocker
```
