# SCALER Pi Extension Architecture Spec

## Purpose

Map SCALER PRD requirements to Pi extension APIs and implementation components.

SCALER should be implemented as a Pi extension with deterministic supervisor code, custom tools/commands, isolated Pi subprocess agents, and project-local `.scaler/` state.

## Extension shape

Recommended project-local extension structure:

```text
.pi/extensions/scaler/
  index.ts
  supervisor.ts
  state.ts
  tools.ts
  commands.ts
  subagents.ts
  context.ts
  memory.ts
  logging.ts
  safety.ts
  budgets.ts
  git.ts
```

SCALER runtime/project data:

```text
.scaler/
  state.json
  memory/
  logs/
  artifacts/
  cache/
  reports/
  plans/
```

## Pi APIs used

### Commands

Use `pi.registerCommand()` for user entrypoints:

- `/scaler` — start/adaptively route a request.
- `/scaler-status` — show supervisor state.
- `/scaler-resume` — resume from checkpoint.
- `/scaler-pause` — pause current run.
- `/scaler-plan` — run/refresh planning.
- `/scaler-compact` — trigger SCALER-aware compaction.

Command handlers can use `ctx.waitForIdle()`, `ctx.newSession()`, `ctx.switchSession()`, and `ctx.ui` when needed.

### Custom tools

Use `pi.registerTool()` for structured model actions:

- `scaler_report` — submit structured agent report.
- `scaler_memory_write` — create external memory file.
- `scaler_memory_retrieve` — request memory retrieval.
- `scaler_tool_request` — request isolated Tool/MCP agent execution.
- `scaler_spawn_task` — request task/research/tool agent spawn.
- `scaler_validation_report` — submit validation result.
- `scaler_debug_attempt` — record failure/attempt data.
- `scaler_replan_request` — request replanning.
- `scaler_permission_request` — request approval or unblock.

Structured tools should be preferred over parsing assistant markdown sections.

### Event hooks

Use Pi lifecycle and agent events:

- `session_start` — load `.scaler/state.json`, indexes, config.
- `session_shutdown` — flush state/logs, cleanup timers/processes.
- `before_agent_start` — inject SCALER guidance or adaptive mode prompt.
- `context` — filter/inject active context, memory retrievals, supervisor state summary.
- `session_before_compact` — custom SCALER compaction.
- `tool_call` — safety gate, permission checks, protected paths, command policy.
- `tool_result` — log results, truncate/store large outputs by reference.
- `agent_start`, `turn_start`, `turn_end`, `agent_end` — usage tracking and watchdog heartbeats.
- `message_end` — capture assistant reports/usage when useful.

### Tool metadata and tool control

Use:

- `pi.getAllTools()` — build short tool catalog and tool metadata map.
- `pi.getActiveTools()` — inspect active tools.
- `pi.setActiveTools()` — reduce exposed tools for parent session where useful.

Child agents should receive limited tools through Pi subprocess flags when possible.

### Compaction

Use:

- `session_before_compact` — generate SCALER-aware summary.
- `ctx.compact()` — trigger compaction when budget rules require it.

Compaction should preserve:

- current goal
- supervisor state summary
- current task
- validated progress
- memory references
- failure/attempt stack summary
- next action

## Supervisor implementation

The supervisor is deterministic TypeScript code, not an LLM.

Responsibilities:

- load/save `.scaler/state.json`
- validate reports
- enforce valid transitions
- select adaptive complexity level
- decide next stage/task
- block invalid transitions
- trigger replanning/debugging/pauses
- coordinate budgets and checkpoints

The supervisor should never trust a free-form claim of completion without structured report and validation evidence.

## Subagent implementation

Use the existing Pi subagent pattern: spawn separate Pi processes in JSON mode with isolated context.

Recommended invocation pattern:

```text
pi --mode json -p --no-session --append-system-prompt <prompt-file> --tools <tool-list> <task-prompt>
```

Each spawned agent gets:

- generated role/prompt
- exact task/research/tool request
- context resolver output
- allowed tools
- permission manifest
- budget/time limits
- required report format

Important: child Pi processes must load SCALER safety/logging rules or run inside an approved sandbox. Otherwise child agents can bypass parent extension safety gates.

## Agent classes

SCALER does not depend on fixed predefined roles.

It dynamically spawns:

- PRD agents
- research agents
- planner agents
- task agents
- tool/MCP agents
- validation/review agents when useful

All are treated as task-agent variants with common report contracts.

## Context selection implementation

Use the `context` event and pre-spawn context resolver.

Parent session context should contain only:

- short supervisor state
- current task/stage
- relevant memory references
- needed retrieved snippets
- validation/debug summary
- next action

Before spawning child agents, build a task-specific prompt from:

- task manifest
- current state
- selected memory/files/snippets
- validation manifest
- permission manifest

Avoid injecting full PRD, full logs, full knowledge reports, or all memory files unless needed.

## Memory implementation

Use project files under `.scaler/memory/`.

Required components:

- memory index
- metadata
- retrieval by id/path/section
- optional search/RAG candidate lookup later
- storage compression/rotation rules

`scaler_memory_retrieve` should inject only selected useful content into the next context iteration.

## Logging implementation

Use append-only JSONL logs under `.scaler/logs/events.jsonl`.

Large data should be written to referenced files under:

- `.scaler/logs/tools/`
- `.scaler/logs/agents/`
- `.scaler/logs/validation/`
- `.scaler/artifacts/`

Pi events and custom tool executions should log:

- state transitions
- prompts/reports
- tool calls/results
- validation results
- safety decisions
- budget/watchdog events
- spawned subprocess metadata

## Safety implementation

Use `tool_call` interception to block/confirm risky built-in and custom tool calls.

Check:

- bash commands
- write/edit paths
- protected paths
- destructive commands
- secret access
- internet/network commands
- deployment/publishing commands
- git history rewrite/destructive operations

Use `ctx.ui.confirm()` when UI exists. In non-UI/background mode, follow configured policy: allow, block, or pause.

## Budgets and watchdogs implementation

Use deterministic timers and counters:

- per-run/stage/task token/cost estimates
- spawned agent count
- tool call count
- wall-clock timers
- subprocess timeouts
- storage usage checks
- heartbeat timestamps

Pi assistant usage metadata and subagent JSON output can provide token/cost data when available.

Hard limits should pause safely and write checkpoint state.

## Research implementation

Research can be integrated through:

- Pi skills, such as Brave Search/browser skills
- custom registered research tools
- MCP servers for search/browser/docs
- `bash`/`curl` only when allowed
- local project search via tools

Research agents should be spawned only when useful. Simple lookup can remain in the current task agent.

Research results should become structured memory/report files, not raw context dumps.

## Validation and CI/CD implementation

Validation uses tool agents or task agents with allowed commands.

Supported local mechanisms:

- project-native commands
- package-manager tests/audits
- Docker
- Docker Compose
- dev containers
- Minikube
- CVE scanners when installed/configured

Validation reports are submitted through `scaler_validation_report` and accepted/rejected by supervisor.

## Git implementation

Use `pi.exec()` or controlled bash commands for git operations.

At task boundaries:

1. inspect git status
2. detect unrelated dirty changes
3. stage only task-related files
4. commit after validation
5. store commit hash in task report/state

Runtime logs/artifacts should be ignored unless intentionally committed.

## Background/unattended mode

Interactive Pi extension mode is enough for development.

For 24/7 unattended work, SCALER should support a runner mode using one of:

- Pi RPC mode
- external supervisor process
- service wrapper around Pi

The same `.scaler/state.json`, logs, budgets, and safety policy should be used in both modes.

## Implementation phases

### Phase 1: Core skeleton

- extension entrypoint
- `/scaler` command
- `.scaler/state.json`
- structured logging
- basic supervisor transitions
- status command

### Phase 2: Task agents

- dynamic task-agent prompt generation
- Pi subprocess spawning
- report parsing
- task validation acceptance

### Phase 3: Memory and context

- memory write/retrieve tools
- context resolver
- context event injection/filtering
- basic compaction hook

### Phase 4: Safety and budgets

- tool_call safety gate
- protected paths
- budget counters
- watchdog timers
- pause/resume checkpoints

### Phase 5: Research/tool agents

- isolated tool/MCP request agents
- research tools/skills integration
- source quality reports

### Phase 6: Validation/CI/CD/git

- validation reports
- Docker/Compose/Minikube helpers
- CVE scan hooks
- per-task git commits

## Compatibility notes

- Pi extension APIs support the required hooks, commands, tools, context mutation, compaction, and subprocess agents.
- Some capabilities depend on installed tools: Docker, Minikube, CVE scanners, search skills, MCP servers, browser automation.
- Child agents must not bypass SCALER safety; load SCALER extension in children or isolate them in sandbox.
- Active context cleanup means controlling what is sent to the model, not deleting Pi session history.
