# SCALER orchestration diagrams

These diagrams use [Mermaid](https://mermaid.js.org/) fenced blocks, which GitHub renders directly inside Markdown files. They are meant to explain the orchestration model, not replace the command reference in `manual/commands.md`.

## Contents

1. [System boundaries and storage](#1-system-boundaries-and-storage)
2. [Whole autonomous orchestration graph](#2-whole-autonomous-orchestration-graph)
3. [Supervisor stage FSM](#3-supervisor-stage-fsm)
4. [Task status FSM](#4-task-status-fsm)
5. [Autonomous Stage I-IV workflow](#5-autonomous-stage-i-iv-workflow)
6. [Task-agent execution flow](#6-task-agent-execution-flow)
7. [Validation, debug, retry, and replan flow](#7-validation-debug-retry-and-replan-flow)
8. [Context selection, splitting, and handoff](#8-context-selection-splitting-and-handoff)
9. [Parent-session context injection and compaction](#9-parent-session-context-injection-and-compaction)
10. [MCP enumeration and tool invocation flow](#10-mcp-enumeration-and-tool-invocation-flow)
11. [Watchdog, pause, and resume flow](#11-watchdog-pause-and-resume-flow)
12. [SCALER data ledger map](#12-scaler-data-ledger-map)

---

## 1. System boundaries and storage

This diagram shows why some files are local to the project while Pi session files stay in `~/.pi/agent`.

```mermaid
flowchart LR
  user[User] --> pi[Pi TUI / CLI]
  pi --> model[LLM provider]
  pi --> builtin[Pi built-in tools\nread/write/edit/bash/...]
  pi --> scaler[SCALER extension\nsrc/index.ts]

  scaler --> projectState[Project runtime state\n.scaler/state.json]
  scaler --> projectLedgers[Project ledgers\n.scaler/reports\n.scaler/prd\n.scaler/plans\n.scaler/context\n.scaler/memory]
  scaler --> localRuntime[Ignored local runtime\n.scaler/logs\n.scaler/watchdogs\n.scaler/checkpoints\n.scaler/tmp]

  pi --> piGlobal[Pi global storage\n~/.pi/agent/sessions\n~/.pi/agent/settings.json\n~/.pi/agent/auth.json]

  projectLedgers --> git[Optional project commits]
  localRuntime -. normally ignored .-> git
  projectState -. normally ignored .-> git
```

Rule of thumb:

- Pi conversations and auth belong to `~/.pi/agent`.
- SCALER project orchestration belongs to `.scaler/`.
- Local runtime telemetry such as `.scaler/state.json` and `.scaler/watchdogs/` is ignored unless you intentionally archive a run.

---

## 2. Whole autonomous orchestration graph

This is the big picture: one user request starts a supervised autonomous loop, but SCALER keeps state, validation, safety, budgets, and recovery ledgers deterministic.

```mermaid
flowchart TD
  spec[Base specification\nPROJECT-SPEC.md / specs / assignment] --> start[/scaler request/]
  start --> state[Create/load supervisor state\n.scaler/state.json]
  state --> budget[Apply complexity and budgets]
  budget --> stageWF[/scaler-stage-workflow execute/]

  stageWF --> prd[Stage I: PRD\nrequirements ledger]
  prd --> knowledge[Stage II: knowledge/research\nresearch requests + reports]
  knowledge --> planning[Stage III: planning\nexecution plan + task definitions]
  planning --> execution[Stage IV: execution\nready tasks]

  execution --> taskStep[/scaler-step execute/]
  taskStep --> context[Resolve task context\nmanifest + selected evidence]
  context --> child[Spawn isolated Pi task agent]
  child --> report[Structured scaler_task_report]
  report --> validate[/scaler-validate-loop execute/]

  validate -->|pass| commit[/scaler-commit or commit-skip/]
  commit --> doneCheck{All tasks and coverage done?}
  doneCheck -->|no| execution
  doneCheck -->|yes| completed[Supervisor stage completed]

  validate -->|fail| debug[/scaler-debug-loop execute/]
  debug -->|fixed| validate
  debug -->|needs research| research[/scaler-research-web or research-run/]
  research --> debug
  debug -->|bad plan| replan[/scaler-replan-run execute/]
  replan --> planning

  taskStep -->|blocked/missing data| missing[/scaler-missing-context*/]
  missing --> taskStep

  state --> watchers[Watchdogs, logs, checkpoints]
  watchers --> pause[Pause/resume recovery]
  budget -->|hard limit| pause
  validate --> logs[Audit and validation ledgers]
  child --> logs
```

Main automation commands:

```text
/scaler <request>
/scaler-stage-workflow execute max=20 research=3 requests=5 internet
/scaler-step execute
/scaler-validate-loop <taskId> execute max=3
/scaler-commit <taskId>
```

---

## 3. Supervisor stage FSM

This is the top-level finite-state machine from `src/supervisor.ts`.

```mermaid
stateDiagram-v2
  [*] --> idle

  idle --> prd
  idle --> knowledge
  idle --> planning
  idle --> execution
  idle --> paused
  idle --> failed

  prd --> knowledge
  prd --> paused
  prd --> failed

  knowledge --> planning
  knowledge --> paused
  knowledge --> failed

  planning --> execution
  planning --> paused
  planning --> failed

  execution --> debugging
  execution --> replanning
  execution --> completed: all tasks validated
  execution --> paused
  execution --> failed

  debugging --> execution
  debugging --> replanning
  debugging --> paused
  debugging --> failed

  replanning --> execution
  replanning --> paused
  replanning --> failed

  paused --> idle: resume only if previousStage=idle
  paused --> prd: resume only if previousStage=prd
  paused --> knowledge: resume only if previousStage=knowledge
  paused --> planning: resume only if previousStage=planning
  paused --> execution: resume only if previousStage=execution
  paused --> debugging: resume only if previousStage=debugging
  paused --> replanning: resume only if previousStage=replanning
  paused --> failed

  completed --> [*]
  failed --> [*]
```

Notes:

- Invalid transitions are not silently applied; they are recorded in `rejectedTransitions`.
- `completed` is guarded: if tasks exist, all tasks must be validated first.
- `paused` remembers `previousStage`; normal resume can only return there.

---

## 4. Task status FSM

This is the per-task finite-state machine from `src/supervisor.ts`.

```mermaid
stateDiagram-v2
  [*] --> pending

  pending --> ready
  pending --> failed

  ready --> running
  ready --> failed

  running --> validating: task agent completed report
  running --> blocked: missing/blocked report
  running --> failed

  validating --> validated: validation passed
  validating --> debugging: validation failed, debugable
  validating --> blocked: validation blocked
  validating --> failed

  debugging --> running: retry implementation
  debugging --> validated: exact fix accepted
  debugging --> needs_replan: task cannot be fixed locally
  debugging --> failed

  blocked --> ready: missing data resolved
  blocked --> failed

  needs_replan --> ready: replan accepted
  needs_replan --> failed

  validated --> [*]
  failed --> [*]
```

Typical autonomous loop:

```text
pending -> ready -> running -> validating -> validated
```

Typical recovery loop:

```text
validating -> debugging -> running -> validating
```

---

## 5. Autonomous Stage I-IV workflow

`/scaler-stage-workflow` is the highest-level coordinator. It advances ready artifacts when possible and otherwise delegates to focused agents or deterministic merge/apply steps.

```mermaid
flowchart TD
  cmd[/scaler-stage-workflow execute/] --> stage{Current supervisor stage}

  stage -->|prd| prdReady{Ready PRD artifact?}
  prdReady -->|yes| advancePRD[Validate and advance to knowledge]
  prdReady -->|no| prdAgent[Run PRD stage agent]
  prdAgent --> ingestPRD[Ingest PRD write / stage artifact]
  ingestPRD --> advancePRD

  stage -->|knowledge| knowReady{Ready knowledge artifact?}
  knowReady -->|yes| advanceKnow[Validate and advance to planning]
  knowReady -->|no| deriveResearch[Derive research requests from PRD]
  deriveResearch --> openResearch{Open research requests?}
  openResearch -->|yes| researchAgents[Run bounded research agents]
  researchAgents --> mergeKnowledge[Merge reports into knowledge report]
  openResearch -->|no| mergeKnowledge
  mergeKnowledge --> advanceKnow

  stage -->|planning| planReady{Ready planning artifact?}
  planReady -->|yes| advancePlan[Validate and advance to execution]
  planReady -->|no| planAgent[Run planning stage agent]
  planAgent --> ingestPlan[Ingest planning report + tasks]
  ingestPlan --> advancePlan

  stage -->|execution| execRefresh[Apply execution plan to tasks]
  execRefresh --> gaps{Coverage gaps or open replans?}
  gaps -->|yes| toReplan[Move to replanning]
  gaps -->|no| execReady[Execution ready: use /scaler-step]

  stage -->|replanning| replanReady{Ready replan artifact/proposal?}
  replanReady -->|yes| acceptReplan[Accept safe replan]
  replanReady -->|no| replanAgent[Run replanner agent]
  replanAgent --> proposal[Proposed plan + preservation check]
  proposal --> acceptReplan
  acceptReplan --> execution
```

Useful inspection commands:

```text
/scaler-stage-status
/scaler-stage-workflow-runs
/scaler-prd-status
/scaler-plan-status
/scaler-replans
```

---

## 6. Task-agent execution flow

`/scaler-step execute` selects and runs one implementation task under lock, context, budget, safety, and structured-report gates.

```mermaid
flowchart TD
  step[/scaler-step execute/] --> select[Select next ready task\nor promote pending to ready]
  select --> gitSafe{Git tree safe for task?}
  gitSafe -->|no| pause[Pause + checkpoint\npre-task dirty tree]
  gitSafe -->|yes| lock[Acquire execution lock]
  lock -->|busy| stopBusy[Stop: lock already held]
  lock -->|acquired| running[Transition task to running]

  running --> manifest[Ensure task context manifest]
  manifest --> resolve[Resolve state/task/PRD/validation/files/memory]
  resolve --> prompt[Build task-agent prompt]
  prompt --> compress[Compression assessment]
  compress --> split{Context split needed?}
  split -->|yes| splitRecord[Record split + externalize large refs]
  split -->|no| budget
  splitRecord --> budget[Update context/spawn budgets]

  budget --> limit{Hard budget limit?}
  limit -->|yes| refused[Refuse expensive run]
  limit -->|no| child[Run isolated Pi child agent]

  child --> structured{Structured scaler_task_report?}
  structured -->|missing/invalid| blocked[Task blocked\nvalidation handoff denied]
  structured -->|status completed| validating[Task -> validating]
  structured -->|needs_data/blocked| blocked
  structured -->|failed| failed[Task -> failed]
  structured -->|needs_replan| needsReplan[Task blocked/needs replan]

  validating --> handoff[Validation handoff record]
  blocked --> release[Release lock]
  failed --> release
  needsReplan --> release
  handoff --> release
```

Key idea: a child process exiting successfully is not enough. SCALER requires the structured task report before validation handoff.

---

## 7. Validation, debug, retry, and replan flow

Validation is the acceptance gate. Debugging is focused on exact failed evidence. Replanning is for bad assumptions or work that cannot be repaired locally.

```mermaid
flowchart TD
  validate[/scaler-validate-loop task execute/] --> manifest[Load validation manifest]
  manifest --> policy{Policy checks pass?\norder, env, disposition, evidence}
  policy -->|no| blocked[Validation blocked]
  policy -->|yes| env[Prepare declared environment\nhost/docker/compose/devcontainer/local CI]
  env --> run[Run validation commands/checklists]
  run --> result{Result}

  result -->|passed| commitReady[Task validation passed]
  commitReady --> commit[/scaler-commit or commit-skip/]
  commit --> validated[Task validated]

  result -->|failed| debugReport[Record failure/debug report]
  debugReport --> debug[/scaler-debug-loop execute/]
  debug --> outcome{Debug outcome}

  outcome -->|fix produced| exactRetry[/scaler-debug-retry execute/]
  exactRetry --> validate

  outcome -->|needs research| research[/scaler-research-web execute internet/]
  research --> debug

  outcome -->|assumption invalid| replanReq[/scaler-replan-request/]
  replanReq --> replan[/scaler-replan-run execute/]
  replan --> accept[/scaler-replan-accept/]
  accept --> validate

  outcome -->|unrecoverable| failed[Task failed]
  blocked --> missing[Resolve missing context or env]
  missing --> validate
```

Useful commands:

```text
/scaler-validation-add ...
/scaler-validation-checklist ...
/scaler-validate-loop <taskId> execute max=3
/scaler-debug-loop <taskId> execute max=3
/scaler-debug-retry-policy ...
/scaler-debug-retry-approve ...
```

---

## 8. Context selection, splitting, and handoff

SCALER uses manifests and budgets so child agents receive enough context without flooding the model.

```mermaid
flowchart TD
  task[Task metadata\nallowed paths, PRD refs, DoD] --> manifest[Task context manifest]
  state[Supervisor state] --> manifest
  validation[Validation manifest/history] --> manifest
  prd[Runtime PRD coverage] --> manifest
  plan[Execution plan] --> manifest
  git[Changed files] --> candidates[Semantic context candidates]
  memory[Memory index] --> candidates
  files[Allowed-path files] --> candidates
  candidates --> approve[/scaler-context-approve/]
  approve --> manifest

  manifest --> resolve[Resolve manifest items]
  resolve --> classify[Classify by priority/scope/exactness]
  classify --> budget[Sort by priority and apply token budget]
  budget --> included[Included context]
  budget --> omitted[Omitted summary]

  included --> compression[Compression assessment]
  compression --> split{Over active context target?}
  split -->|no| prompt[Task/stage/research/debug prompt]
  split -->|yes| splitRecord[Context split record\n.scaler/context/splits.json]
  splitRecord --> externalize[Externalize large items to memory\nwith sha256 + refs]
  externalize --> minimal[Minimal context item IDs\nexact required + references]
  minimal --> handoff[/scaler-context-handoff execute/]
  handoff --> fresh[Fresh minimal-context child agent]
```

Context item dimensions:

- priority: `required`, `useful`, `optional`;
- scope: `full`, `section`, `snippet`, `summary`, `reference-only`;
- exactness: `exact`, `summary-ok`, `reference-only`.

Commands:

```text
/scaler-context-init <taskId>
/scaler-context-candidates <taskId> <query> limit=5
/scaler-context-approve <taskId> <candidateId> <query>
/scaler-context-status <taskId>
/scaler-context-splits <taskId>
/scaler-context-handoff <splitId> execute
```

---

## 9. Parent-session context injection and compaction

SCALER also participates in the parent Pi session. It injects compact approved context and customizes compaction summaries.

```mermaid
sequenceDiagram
  participant User
  participant Pi as Pi parent session
  participant Scaler as SCALER extension
  participant State as .scaler state/context/memory
  participant Model as LLM provider

  User->>Pi: Send prompt or SCALER command
  Pi->>Scaler: context event before provider call
  Scaler->>State: Load current task manifest
  State-->>Scaler: Approved non-optional summaries/snippets/refs
  Scaler-->>Pi: Inject compact SCALER selected context
  Pi->>Model: Provider request with context
  Model-->>Pi: Assistant/tool response
  Pi->>Scaler: turn_end with usage
  Scaler->>State: Record provider usage budgets and heartbeat
  Scaler->>Pi: Request compaction if context exceeds target
  Pi->>Scaler: session_before_compact
  Scaler->>State: Build SCALER-aware summary with task, blockers, refs
  Scaler-->>Pi: Custom compaction result
```

The injected parent-session context intentionally excludes optional/full items unless they were approved and fit the compact budget.

---

## 10. MCP enumeration and tool invocation flow

SCALER does not blindly run MCP servers. It first enumerates declarations and records risk metadata. Tool execution is delegated to bounded tool-agent transactions with structured results.

```mermaid
flowchart TD
  mcpCmd[/scaler-mcp-enumerate/] --> scan[Scan local MCP config files\n.mcp.json, mcp.json, .cursor, .vscode, .claude, package.json]
  scan --> parse{Valid server declaration?}
  parse -->|yes| recordMcp[Record server\ntransport stdio/http/sse\nrisk high/external]
  parse -->|no| invalid[Record invalid declaration]
  recordMcp --> mcpLedger[.scaler/tool-requests/mcp-servers.json]
  invalid --> mcpLedger
  mcpLedger --> list[/scaler-mcp-servers/]

  request[scaler_tool_request\nor prepared request ledger] --> catalog[/scaler-tool-catalog/]
  catalog --> discover[/scaler-tool-discover execute/]
  discover --> schema[Record tool schema/risk/docs]
  schema --> run[/scaler-tool-run requestId execute/]

  run --> prompt[Build tool-agent prompt\nallowed tools only]
  prompt --> child[Spawn isolated Pi tool agent]
  child --> result{Structured scaler_tool_result?}
  result -->|yes completed/failed/blocked| close[Close request and record result]
  result -->|missing| missing[Transaction status missing_result]

  missing --> iterate[/scaler-tool-iterate execute/]
  missing --> replay[/scaler-tool-replay execute/]
  replay --> approval{Closed request?}
  approval -->|yes| needApproval[/scaler-tool-replay-approval approve/]
  needApproval --> replay
  approval -->|no| child
  iterate --> child

  close --> transactions[/scaler-tool-transactions/]
  missing --> transactions

  schedule[/scaler-tool-schedule execute parallel=N/] --> classify[Classify prepared requests\nlow-risk parallel vs serial]
  classify --> parallel[Parallel safe batch]
  classify --> serial[Serialized risky/unknown work]
  parallel --> run
  serial --> run
```

Important safety properties:

- MCP enumeration records declarations; it does not execute servers.
- Tool agents receive only explicitly allowed tools.
- Missing structured results do not count as successful completion.
- Closed-request replay requires explicit replay approval.
- Unknown/risky/destructive/external/secret work should remain serialized or blocked by policy.

---

## 11. Watchdog, pause, and resume flow

Watchdogs are for recovering from stalled work, repeated replanning, and interrupted processes.

```mermaid
flowchart TD
  events[Pi lifecycle/tool events\nagent_start, tool_start, turn_end, agent_end] --> heartbeat[Record heartbeat\n.scaler/watchdogs/heartbeats.json]
  manual[/scaler-heartbeat .../] --> heartbeat

  assess[/scaler-watchdogs/] --> check[Assess heartbeats, replan count, budget approvals]
  heartbeat --> check
  check --> trigger{Hard trigger?}
  trigger -->|no| ok[No watchdog pause]
  trigger -->|yes with execute| pause[Transition to paused]
  pause --> checkpoint[Write watchdog pause checkpoint]
  checkpoint --> resumeCheck[/scaler-resume-check/]

  crash[Pi killed / terminal closed / reboot] --> restart[Restart pi in same project]
  restart --> resumeCheck
  resumeCheck --> findings{State/git/logs/memory/checkpoints/budget OK?}
  findings -->|ok/warning accepted| resume[/scaler-resume reason/]
  findings -->|failed| repair[Repair issue\nclear stale lock, fix git, restore files]
  repair --> resumeCheck
  resume --> continueWork[Continue stage workflow, task step, validation, or debug]
```

Useful recovery commands:

```text
/scaler-resume-check
/scaler-resume resumed after restart
/scaler-lock
/scaler-lock-clear <reason>
/scaler-watchdogs execute
/scaler-runs
/scaler-task-reports
```

---

## 12. SCALER data ledger map

This shows the main persistent evidence ledgers. Some are project artifacts; some are ignored runtime telemetry.

```mermaid
flowchart LR
  scaler[.scaler/] --> state[state.json\ncurrent run state\nignored]
  scaler --> logs[logs/\naudit events, details, large tool refs\nignored]
  scaler --> watchdogs[watchdogs/\nheartbeats, events, cleanup, resume checks\nignored]
  scaler --> checkpoints[checkpoints/\npause/conductor snapshots\nusually ignored]

  scaler --> prd[prd/\nrequirements + coverage]
  scaler --> plans[plans/\nexecution plans + replan proposals]
  scaler --> knowledge[knowledge/\nmerged knowledge reports]
  scaler --> context[context/\ntask manifests, splits, handoffs, compactions]
  scaler --> memory[memory/\nindexed memories + externalized context]
  scaler --> research[research/\nrequests, reports, web transactions]
  scaler --> reports[reports/\ntask runs, task reports, validation, commits, stage workflow]
  scaler --> tools[tool-requests/\ntool catalog, transactions, schemas, MCP records]
  scaler --> safety[safety/\npolicies, approvals, scans]
  scaler --> storage[storage/\ninventory, maintenance, archives]
  scaler --> locks[locks/\nexecution lock]
  scaler --> cicd[cicd/\ngenerated local CI wrappers/configs\nignored by default]
```

When reviewing a run, start with:

```text
/scaler-status
/scaler-stage-status
/scaler-tasks
/scaler-task-reports
/scaler-budget-status
/scaler-watchdogs
```

When reviewing project evidence, inspect:

```text
.scaler/prd/
.scaler/plans/
.scaler/knowledge/
.scaler/reports/
.scaler/research/
```
