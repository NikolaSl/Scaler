# SCALER Supervisor Spec

## Purpose

The supervisor is the deterministic state machine that controls Scaler execution.

It is not an LLM. It reads structured reports, validates required fields, updates persistent state, and allows or rejects state transitions.

Agents do the reasoning work. The supervisor controls process discipline.

## Principles

- Use the lightest reliable workflow according to `specs/adaptive-orchestration.md`.
- All progress is report-driven.
- Agents can propose state changes, but cannot directly change state.
- Invalid transitions are rejected and recorded.
- State transitions are written to the structured log.
- Debug failure and attempt records are persisted.
- A task is complete only after validation is accepted.
- State is persisted so execution can pause, resume, recover, or replan.

## Persistent state

Store supervisor state in `.scaler/state.json`.

Minimum state:

```json
{
  "complexityLevel": 3,
  "stage": "execution",
  "currentTaskId": "T-003",
  "tasks": [],
  "completedTaskIds": [],
  "validatedTaskIds": [],
  "failedTaskId": null,
  "blockers": [],
  "memoryRefs": [],
  "budgets": {},
  "orchestrationReason": "Stage III plan requires multiple validated tasks",
  "updatedAt": "ISO-8601"
}
```

## Stage states

- `prd`
- `knowledge`
- `planning`
- `execution`
- `debugging`
- `replanning`
- `paused`
- `completed`
- `failed`

## Task states

- `pending`
- `ready`
- `running`
- `validating`
- `debugging`
- `validated`
- `blocked`
- `needs_replan`
- `failed`

## Stage transitions

| From | To | Trigger |
| --- | --- | --- |
| `prd` | `knowledge` | PRD report accepted and `agent-prd.md` exists. |
| `knowledge` | `planning` | Knowledge report accepted and required references exist. |
| `planning` | `execution` | Sequential plan accepted with task definitions and DoD. |
| `execution` | `debugging` | Current task validation fails. |
| `debugging` | `execution` | Debug report accepted and task validation passes or can retry. |
| `execution` | `replanning` | Task reports missing/incorrect plan, impossible task, invalid assumption, or POC need. |
| `debugging` | `replanning` | Debug investigation cannot find working approach. |
| `replanning` | `execution` | Updated plan version accepted with validated progress preserved. |
| any active state | `paused` | Budget, approval, missing input, or user pause condition. |
| `paused` | previous active state | Pause reason resolved. |
| `execution` | `completed` | All planned tasks are validated. |
| any active state | `failed` | Fatal error or unrecoverable state. |

## Task transitions

| From | To | Trigger |
| --- | --- | --- |
| `pending` | `ready` | Required inputs, references, and DoD are available. |
| `ready` | `running` | Task agent is spawned. |
| `running` | `validating` | Task agent submits completion report. |
| `validating` | `validated` | DoD and validation report are accepted. |
| `validating` | `debugging` | Validation fails. |
| `debugging` | `running` | New debug approach is selected and retry is allowed. |
| `debugging` | `validated` | Debug fix passes full validation. |
| `running` | `blocked` | Task agent requests missing data or permission. |
| `blocked` | `ready` | Missing data or permission is provided. |
| `debugging` | `needs_replan` | Investigation cannot produce a working approach. |
| `needs_replan` | `ready` | Updated plan redefines the task and required inputs. |
| any non-final state | `failed` | Fatal task failure or cancelled execution. |

## Task validation acceptance

A task can become `validated` only when:

1. Required output exists.
2. Definition of Done is checked.
3. Required validation gates passed or skipped gates have accepted reasons.
4. Task and validation reports are stored.
5. Git commit is created or explicitly skipped according to `specs/git-workflow.md`.
6. Supervisor accepted the reports.

## Rejected transitions

When a transition is rejected, the supervisor should:

1. Keep the previous state unchanged.
2. Record rejection reason in state and logs.
3. Ask the responsible agent for a corrected report or missing evidence.
4. Pause only if correction requires user input, new investigation, or budget approval.

## Reports consumed by supervisor

Minimum report types:

- PRD report.
- Knowledge report.
- Plan report.
- Task completion report.
- Validation report.
- Debug report.
- Replan report.
- Blocker/missing-input report.

Each report must include enough structured data for the supervisor to decide whether the requested transition is valid.

See also:

- `specs/adaptive-orchestration.md` for proportional workflow escalation.
- `specs/budgets-watchdogs.md` for budgets, watchdogs, checkpoints, and resume behavior.
- `specs/logging.md` for required audit trail events.
- `specs/attempt-tracking.md` for debug failure and attempt records.
- `specs/validation.md` for validation gates and reports.
- `specs/replanning.md` for plan versioning and replanning protocol.
- `specs/safety-permissions.md` for safety gates, permissions, and secure development.
- `specs/git-workflow.md` for per-task commit rules.
