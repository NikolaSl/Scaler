# SCALER Budgets and Watchdogs Spec

## Purpose

Scaler must not run uncontrolled.

Budgets and watchdogs limit token use, cost, time, tools, agents, storage, and stuck execution. They allow long-running work while preventing runaway loops, hallucination spending, and machine/resource exhaustion.

## Principle

Every run, stage, task, agent, and tool-agent should have explicit limits.

Scaler should warn at soft limits, pause at hard limits, and preserve enough state to resume safely.

## Budget scopes

Budgets may be defined for:

- full Scaler run
- stage
- plan version
- task
- task agent
- research agent
- tool/MCP agent
- debug loop
- validation loop

## Budget types

Track where available:

- input/output tokens
- estimated and actual cost
- wall-clock time
- number of LLM calls/turns
- number of tool calls
- number of spawned agents
- number of debug attempts
- number of research queries/pages
- storage usage under `.scaler/`
- subprocess/container runtime

## Soft and hard limits

Soft limit behavior:

- log warning
- summarize current state
- reduce context or switch to cheaper path when possible
- ask conductor/supervisor whether to continue

Hard limit behavior:

- stop spawning new agents
- stop new expensive tool/research calls
- pause execution safely
- write checkpoint
- report current state, usage, and next options

## Watchdogs

Watchdogs should detect:

- no progress for a configured time
- repeated same failure/attempt loop
- task agent exceeding timeout
- tool/MCP agent exceeding timeout
- subprocess/container stuck or silent
- storage growing too fast
- too many spawned agents
- repeated replanning without progress

When triggered, watchdogs should pause, debug, kill/cleanup subprocesses when safe, or escalate according to supervisor rules.

## Progress heartbeat

Long-running agents/tools should produce heartbeat/progress events.

A heartbeat may include:

- current action
- last meaningful progress
- usage so far
- active subprocess/tool
- current validation/debug step

Missing heartbeat beyond timeout is a stuck-agent signal.

## Checkpoints

Scaler should checkpoint state before and after important transitions:

- run start
- stage start/end
- task start/end
- before risky action
- before replanning
- after validation
- after git commit
- before pause/shutdown

Checkpoint data should include:

- supervisor state
- current plan version
- current task state
- completed/validated tasks
- memory indexes
- budget usage
- log positions/references
- git status/commit refs

## Resume behavior

On resume, Scaler should:

1. Load supervisor state.
2. Verify git status and project files.
3. Verify `.scaler/` indexes and logs.
4. Identify last safe checkpoint.
5. Resume from the next valid supervisor transition.
6. Avoid rerunning already validated tasks unless required.

## Budget policy by complexity

Adaptive orchestration should choose budgets according to complexity level:

- simple tasks get small budgets and few/no subagents
- complex tasks get staged budgets
- high-risk/long-running tasks require explicit budget policy

Escalation to higher complexity may require budget expansion approval.

## Reports

Budget/watchdog reports should include:

- scope
- limit type
- soft/hard limit
- usage
- trigger reason
- current state
- recommended action: continue, reduce scope, pause, replan, ask approval, or fail

## Logging

Log budget configuration, usage snapshots, soft-limit warnings, hard-limit pauses, watchdog triggers, checkpoints, resumes, and cleanup actions according to `specs/logging.md`.
