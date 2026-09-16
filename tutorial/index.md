# SCALER tutorial: autonomous high-scale project work

> This describes the existing implementation, not revision 2 guarantees.
> See the [requirements review](../requirements-review.md) and
> [known coverage limitations](../dev-progress-tracker/requirements-v2-coverage.md).
> Runtime commands are unchanged by the requirements revision.

This tutorial is scenario-first. It assumes you want SCALER to do as much work autonomously as possible, but you still want to know what to do when the run pauses, needs approval, fails validation, lacks context, or must be resumed after interruption.

For the exhaustive command reference, see `manual/commands.md`. This tutorial explains the most useful path through those commands.

## Contents

1. [What SCALER is doing](#1-what-scaler-is-doing)
2. [Before your first run](#2-before-your-first-run)
3. [Full automation from a base specification](#3-full-automation-from-a-base-specification)
4. [Monitoring while automation is running](#4-monitoring-while-automation-is-running)
5. [Normal interaction while work is in progress](#5-normal-interaction-while-work-is-in-progress)
6. [Resume after Pi exits, crashes, or the computer restarts](#6-resume-after-pi-exits-crashes-or-the-computer-restarts)
7. [When progress stalls: heartbeats and watchdogs](#7-when-progress-stalls-heartbeats-and-watchdogs)
8. [Budgets, complexity, and approvals](#8-budgets-complexity-and-approvals)
9. [Missing context, memory, and research](#9-missing-context-memory-and-research)
10. [Validation failures, debugging, and retry](#10-validation-failures-debugging-and-retry)
11. [Safety, internet, external tools, and scans](#11-safety-internet-external-tools-and-scans)
12. [CI/CD and validation environments](#12-cicd-and-validation-environments)
13. [Replanning without losing validated progress](#13-replanning-without-losing-validated-progress)
14. [Task quality and manual task repair](#14-task-quality-and-manual-task-repair)
15. [Tool orchestration scenarios](#15-tool-orchestration-scenarios)
16. [Storage and log maintenance](#16-storage-and-log-maintenance)
17. [Git workflow and finishing a run](#17-git-workflow-and-finishing-a-run)
18. [Resetting or starting over](#18-resetting-or-starting-over)
19. [Scenario command map](#19-scenario-command-map)

See `tutorial/use-case-tracker.md` for a checklist of covered scenarios. For GitHub-renderable Mermaid diagrams of the FSMs, agent flows, context flow, MCP/tool flow, and resume/watchdog flow, see `tutorial/diagrams.md`.

---

## 1. What SCALER is doing

SCALER is a Pi extension for supervised autonomous project work.

Pi provides the interactive coding agent, model access, tools, and session history. SCALER adds project-level orchestration: stages, tasks, validation, budgets, watchdogs, reports, research, replanning, safety, and persistence.

### The important folders

| Path | Purpose | Commit? |
|---|---|---|
| `~/.pi/agent/sessions/` | Pi conversation/session history | No; Pi manages it globally |
| `.scaler/state.json` | Current SCALER run state: stage, tasks, budgets | Usually no; local runtime state |
| `.scaler/reports/` | Task-agent runs, planning reports, validation handoffs, commits | Sometimes; useful evidence if you want reproducible audit trails |
| `.scaler/prd/`, `.scaler/plans/`, `.scaler/knowledge/` | Runtime PRD, plan, knowledge artifacts | Often yes if they are project artifacts |
| `.scaler/logs/` | Detailed audit/tool logs | Usually no; can be large/sensitive |
| `.scaler/watchdogs/` | Heartbeats, watchdog events, resume checks | No; local runtime telemetry |
| `.scaler/checkpoints/` | Pause/resume/conductor checkpoints | Usually no unless you intentionally archive a run |

The repository now ignores local runtime files such as `.scaler/state.json` and `.scaler/watchdogs/`.

### The main SCALER lifecycle

A high-scale autonomous run usually goes through this path:

```text
base specification
  -> PRD stage
  -> knowledge/research stage
  -> planning stage
  -> execution tasks
  -> validation/debug/retry
  -> commit or documented commit-skip
  -> completed run
```

The most important command for staged autonomy is:

```text
/scaler-stage-workflow execute max=20 research=3 requests=5 internet auto-accept-replan=on
```

The most important command for executing implementation tasks is:

```text
/scaler-step execute
```

The most important command for validation is:

```text
/scaler-validate-loop <taskId> execute max=3
```

---

## 2. Before your first run

### Use case UC-001: verify SCALER loads

From the project directory:

```bash
pi
```

In Pi, run:

```text
/scaler-status
```

Expected result:

- SCALER creates or loads `.scaler/state.json`.
- You see a compact status such as stage, complexity level, task counts, and budget usage.

If Pi fails before startup because an extension cannot load, start without extensions:

```bash
pi -ne
```

Then fix the extension/package configuration before running normal `pi` again.

### Use case UC-037: bootstrap git ignore/status evidence

Run:

```text
/scaler-git-bootstrap
```

This records git bootstrap evidence and helps keep generated runtime files out of commits.

Before a large run, also check:

```bash
git status --short
```

Recommended starting point:

- clean working tree, or
- intentional uncommitted spec files only.

### Prepare your base specification

A base specification can be one or more files, for example:

```text
assignement.md
requirements-catalog.md
specs/index.md
```

For a new project, start with a simple file such as:

```text
PROJECT-SPEC.md
```

Include:

1. goal of the project;
2. required features;
3. non-goals;
4. validation expectations;
5. known constraints;
6. delivery criteria.

You do not need a perfect spec. SCALER can create research requests, missing-context requests, and replans later.

---

## 3. Full automation from a base specification

This is the default path when you want SCALER to lead a project toward completion.

### Use case UC-002: start a run from the specification

In Pi, start the SCALER run:

```text
/scaler Build this project from PROJECT-SPEC.md. Operate autonomously, preserve validated work, use validation gates, and ask only when external approval or missing context is required.
```

For the current repository, you might write:

```text
/scaler Continue implementing the SCALER project from assignement.md, requirements-catalog.md, specs/, and manual/. Prefer autonomous execution with validation, evidence, and commits for validated tasks.
```

Expected result:

- `.scaler/state.json` is created or updated.
- SCALER chooses a complexity level from the request.
- SCALER moves from `idle` into the first appropriate stage.

Important: `/scaler` starts the supervised run. It does not by itself execute the full workflow. The next command drives the staged workflow.

### Use case UC-003: run staged automation

Run:

```text
/scaler-stage-workflow execute max=20 research=3 requests=5 internet auto-accept-replan=on
```

What this does:

1. checks whether PRD, knowledge, planning, execution, or replanning artifacts already exist;
2. runs focused child agents when artifacts are missing;
3. derives bounded research requests;
4. runs bounded research fanout;
5. writes or refreshes PRD and planning ledgers;
6. detects coverage gaps;
7. accepts safe replans when allowed;
8. records workflow runs under `.scaler/reports/stage-workflow-runs.json`.

If you do not want internet research, omit `internet`:

```text
/scaler-stage-workflow execute max=20 research=2 requests=3 auto-accept-replan=on
```

If you want to review replans before accepting them:

```text
/scaler-stage-workflow execute max=20 research=3 requests=5 internet auto-accept-replan=off
```

Then inspect and accept manually later with:

```text
/scaler-replan-proposal-status
/scaler-replan-accept
```

Repeat the stage workflow command until these show healthy progress:

```text
/scaler-status
/scaler-stage-status
/scaler-prd-status
/scaler-plan-status
```

A typical staged run may need several passes. That is normal.

### Use case UC-004: execute implementation tasks

Once planning has produced tasks, inspect them:

```text
/scaler-tasks
```

Then run one autonomous task step:

```text
/scaler-step execute
```

What happens:

1. SCALER selects a ready task or promotes a pending task.
2. It transitions the task to `running`.
3. It builds a task-agent prompt with approved context.
4. It starts an isolated Pi child agent.
5. The child agent must emit a structured `scaler_task_report`.
6. A completed report moves the task to `validating`.
7. Missing/invalid/blocked reports stop the handoff and preserve evidence.

Inspect results:

```text
/scaler-runs
/scaler-task-reports
/scaler-tasks
```

Repeat:

```text
/scaler-step execute
```

until there are no executable ready tasks, or until SCALER asks for intervention.

### Use case UC-005: validate and commit tasks

For a task in `validating` status:

```text
/scaler-validate-loop T-001 execute max=3
```

If validation passes, commit it:

```text
/scaler-commit T-001
```

If the task should not be committed, record why:

```text
/scaler-commit-skip T-001 | generated documentation only; commit will be batched with T-002
```

SCALER treats commit evidence or commit-skip evidence as part of validated-task completion.

### Use case UC-006: know when the work is done

Run:

```text
/scaler-status
/scaler-tasks
/scaler-prd-status
/scaler-plan-status
/scaler-stage-status
```

A run is close to done when:

- stage is `completed`, or execution has no remaining planned tasks;
- every task is `validated` or intentionally skipped/closed with evidence;
- PRD coverage has no critical gaps;
- validation reports are passing or explicitly waived;
- commits or commit-skips exist for finished tasks;
- `git status --short` only shows expected generated docs/artifacts.

---

## 4. Monitoring while automation is running

The goal of monitoring is to understand progress without taking control away from SCALER.

### Use case UC-007: quick health check

Run:

```text
/scaler-status
/scaler-budget-status
/scaler-tasks
```

Read the output as:

- `stage`: where the run is in the overall lifecycle;
- `level`: selected complexity;
- `validated=X/Y`: how many tasks are done;
- budget decision: whether usage is OK, soft-limited, or hard-limited;
- task statuses: pending, ready, running, validating, debugging, blocked, needs_replan, failed, validated.

### Use case UC-008: inspect stage artifacts

Run:

```text
/scaler-stage-status
/scaler-stage-workflow-runs
/scaler-prd-status
/scaler-plan-status
/scaler-research-status
```

Use these when you want to know whether SCALER has produced:

- a PRD;
- a knowledge report;
- a plan;
- execution coverage;
- replan proposals;
- research reports.

Avoid manually editing generated runtime ledgers unless you are intentionally repairing a broken run.

---

## 5. Normal interaction while work is in progress

SCALER is designed for autonomy, but user intervention is still useful when you know something the model does not.

### Use case UC-009: pause cleanly

Before closing the terminal or switching tasks, you can pause:

```text
/scaler-pause stopping for the day
```

This preserves state and allows a cleaner resume.

### Add guidance without breaking autonomy

Use normal Pi messages for general steering, for example:

```text
Prefer minimal changes. Do not rewrite unrelated files. If validation fails, debug only the failing task.
```

Use SCALER commands when you want deterministic state changes.

### Use case UC-010: add validation gates

If you know a task needs a specific test:

```text
/scaler-validation-add T-001 | unit | npm test -- --runInBand | Run unit tests | required | unit | exits 0 | tests:T-001 | host
```

For non-software acceptance evidence:

```text
/scaler-validation-checklist T-001 | completeness | Acceptance checklist | scope::passed::required::All requested scope is covered::manual-review:T-001 | manual-review:T-001
```

Then validate:

```text
/scaler-validate-loop T-001 execute max=3
```

---

## 6. Resume after Pi exits, crashes, or the computer restarts

SCALER state is project-local. Pi sessions are global under `~/.pi/agent/sessions/`. After interruption, you normally restart Pi in the same project directory and verify SCALER state.

### Use case UC-011: normal resume after restart

From the project directory:

```bash
pi
```

In Pi:

```text
/scaler-resume-check
/scaler-status
/scaler-resume resumed after restart
```

Then inspect where work stopped:

```text
/scaler-tasks
/scaler-runs
/scaler-stage-workflow-runs
```

Continue with the appropriate driver:

- staged artifacts missing: `/scaler-stage-workflow execute max=20 research=3 requests=5`
- task execution pending: `/scaler-step execute`
- task validating: `/scaler-validate-loop <taskId> execute max=3`
- task debugging: `/scaler-debug-loop <taskId> execute max=3`

### Use case UC-012: recover from interrupted task-agent execution

If Pi or the computer died while a child task agent was running, first inspect the lock and runs:

```text
/scaler-lock
/scaler-runs
/scaler-task-reports
```

If the lock is stale and no process is running, clear it with a reason:

```text
/scaler-lock-clear interrupted Pi process after reboot; no child process remains
```

Then inspect the task:

```text
/scaler-tasks
```

Continue based on status:

- `running` with no report: rerun or mark/retry via task update;
- `blocked`: inspect reports and missing context;
- `validating`: run validation;
- `failed`: debug or retry;
- `needs_replan`: replan.

A conservative continuation is:

```text
/scaler-step execute
```

SCALER should select the next valid step according to state.

---

## 7. When progress stalls: heartbeats and watchdogs

SCALER writes heartbeat telemetry for Pi lifecycle and tool events. This is not meant for commits; it helps detect no-progress runs.

### Use case UC-013: verify recent progress

Run:

```text
/scaler-heartbeat list
/scaler-watchdogs
```

If there are no hard triggers, continue normally.

### Use case UC-014: pause on hard watchdog trigger

If a run appears stuck:

```text
/scaler-watchdogs execute
```

This can:

1. detect stale/no-progress heartbeats;
2. detect repeated replanning without validated progress;
3. write watchdog events;
4. pause the run when a hard trigger requires it;
5. write a checkpoint.

After a pause:

```text
/scaler-resume-check
/scaler-status
```

Then choose a recovery path:

- missing context: go to [section 9](#9-missing-context-memory-and-research);
- validation failure: go to [section 10](#10-validation-failures-debugging-and-retry);
- repeated replanning: go to [section 13](#13-replanning-without-losing-validated-progress);
- stale lock: use `/scaler-lock-clear <reason>`.

---

## 8. Budgets, complexity, and approvals

Budgets keep autonomous runs from spending unbounded tokens, tool calls, subprocesses, time, storage, or cost.

### Use case UC-015: approve high-complexity autonomy

For large projects, SCALER may require explicit budget approval at high complexity levels.

Inspect:

```text
/scaler-budget-status
```

Approve a level if you accept the cost/risk:

```text
/scaler-budget-policy level=4 approve
```

For even larger work:

```text
/scaler-budget-policy level=5 approve
```

Only approve high levels when you expect long-running autonomous work.

### Use case UC-016: set hard limits

Examples:

```text
/scaler-budget-set estimatedCostMicros | - | 500000
/scaler-budget-set contextTokens | 100000 | 200000
/scaler-budget-set toolCalls | 80 | 120
/scaler-budget-set spawnedAgents | 8 | 12
/scaler-budget-status
```

Interpretation:

- soft limit: SCALER should reduce scope or de-escalate;
- hard limit: SCALER should pause/block supported expensive paths.

### Use case UC-017: reduce scope after budget pressure

If budget status shows pressure:

```text
/scaler-adapt apply
```

If the project scope itself must change:

```text
/scaler-replan-request Budget pressure requires reducing scope while preserving validated tasks. | | budget-status | REQ-001
/scaler-replan-run execute
/scaler-replan-proposal-status
/scaler-replan-accept
```

---

## 9. Missing context, memory, and research

SCALER should not guess when important context is missing. Use these commands to help it find or record evidence.

### Use case UC-018: search existing memory/context first

```text
/scaler-memory-search authentication retry policy limit=5
/scaler-context-candidates T-001 authentication retry policy limit=5
/scaler-context-approve T-001 <candidateId> authentication retry policy
/scaler-context-status T-001
```

Approved context is injected into later task-agent prompts.

### Use case UC-019: resolve missing context

Inspect missing context requests:

```text
/scaler-missing-context T-001
```

Try deterministic resolution:

```text
/scaler-missing-context-run <requestId> execute
```

If internet is needed and allowed:

```text
/scaler-missing-context-run <requestId> execute internet
```

If you know the answer manually:

```text
/scaler-missing-context-resolve <requestId> | The API supports idempotent retries with exponential backoff. | docs:api-retry-section
```

Then continue:

```text
/scaler-step execute
```

### Use case UC-020: request and run research

Create a research request:

```text
/scaler-research-request Which retry strategy is safest for this provider API? | task needs external API behavior | T-001 | REQ-004 | implementation
```

Run bounded web research:

```text
/scaler-research-web <requestId> execute internet max-queries=3
```

Inspect:

```text
/scaler-research-transactions <requestId>
/scaler-research-runs <requestId>
/scaler-research-status
```

If you have a manual source:

```text
/scaler-research-report Which retry strategy is safest? | Use capped exponential backoff with jitter. | high | SRC-API-DOC | Provider retry docs | primary | https://example.com/retry | <requestId> | T-001 | REQ-004
```

---

## 10. Validation failures, debugging, and retry

Validation failure is normal. SCALER's goal is to debug the exact failing evidence, not wander.

### Use case UC-021: handle a failed validation

Run validation:

```text
/scaler-validate-loop T-001 execute max=3
```

If it fails, inspect:

```text
/scaler-debug-reports
/scaler-tasks
```

Run focused debugging:

```text
/scaler-debug-run T-001 execute
```

Or use the bounded conductor:

```text
/scaler-debug-loop T-001 execute max=3
```

Then rerun validation:

```text
/scaler-validate-loop T-001 execute max=3
```

### Use case UC-022: retry only the failed validation

If a debug report identifies a specific failure and fix:

```text
/scaler-debug-retry T-001 execute
```

If retry policy requires approval:

```text
/scaler-debug-retry-approve <debugReportId> | T-001 | retry exact failed validation after targeted fix
/scaler-debug-retry T-001 execute
```

Inspect approvals:

```text
/scaler-debug-retry-approvals
```

### Use case UC-023: configure retry automation

Conservative policy:

```text
/scaler-debug-retry-policy auto-start=off require-approval=on post-exact-pass=stop
```

More autonomous policy:

```text
/scaler-debug-retry-policy auto-start=on require-approval=off post-exact-pass=validate
```

Most autonomous, commit after exact pass and full validation:

```text
/scaler-debug-retry-policy auto-start=on require-approval=off post-exact-pass=validate-commit
```

Use the most autonomous setting only when validation gates are reliable.

---

## 11. Safety, internet, external tools, and scans

SCALER should pause or ask for approval when work touches internet, external services, destructive actions, secrets, or sandbox boundaries.

### Use case UC-024: allow internet/external/sandbox behavior intentionally

Inspect current policy:

```text
/scaler-safety-policy
```

Allow internet research:

```text
/scaler-safety-policy allow-internet=on
```

Allow external services only when expected:

```text
/scaler-safety-policy allow-external=on
```

Allow bounded sandbox exceptions:

```text
/scaler-safety-policy allow-sandbox=on
```

Approve a one-off risky action:

```text
/scaler-safety-approval approve action=external reason="needed to query provider docs" ttl=1h uses=1
```

Revoke if you change your mind:

```text
/scaler-safety-approval revoke <approvalId>
```

### Use case UC-025: run safety scans

Plan scans without executing:

```text
/scaler-safety-scan
```

Run available scans:

```text
/scaler-safety-scan execute kinds=npm_audit,trivy_fs
```

Use this before accepting generated dependency or container changes.

---

## 12. CI/CD and validation environments

For serious autonomous work, validation should run in declared environments, not accidental host state.

### Use case UC-026: prepare CI/CD environment metadata

Create or update an environment record:

```text
/scaler-cicd-env local-ci | npm test | T-001 | unit | node | execute scan=on
```

List environments:

```text
/scaler-cicd-envs
/scaler-validation-envs
```

### Use case UC-027: add non-host validation

For Docker Compose validation:

```text
/scaler-validation-add T-001 | local-ci | docker compose run --rm test | Run local CI in Compose | required | local_ci | exits 0 | ci:T-001 | compose
/scaler-validate-loop T-001 execute max=3
```

If Docker/Compose is missing, SCALER should block with evidence rather than pretending validation passed.

---

## 13. Replanning without losing validated progress

Replanning is for changed assumptions, coverage gaps, blocked tasks, or repeated failures. It must preserve validated work.

### Use case UC-028: accept safe replanning proposal

Run replanning:

```text
/scaler-replan-run execute
/scaler-replan-proposal-status
```

If it preserves validated tasks and is safe:

```text
/scaler-replan-accept
```

Then continue:

```text
/scaler-stage-workflow execute max=10 research=2 requests=3
/scaler-step execute
```

### Use case UC-029: create a manual replan request

When you know assumptions changed:

```text
/scaler-replan-request API changed; implementation plan must use v2 endpoints while preserving completed auth tasks. | T-003 | docs:api-v2 | REQ-010
```

Then:

```text
/scaler-replan-run execute
/scaler-replan-proposal-status
/scaler-replan-accept
```

---

## 14. Task quality and manual task repair

Tasks should be atomic, tied to requirements, bounded by allowed paths, and validated by explicit gates.

### Use case UC-030: repair task quality before execution

Inspect task quality:

```text
/scaler-task-quality
/scaler-task-quality T-001
```

If a task lacks DoD or allowed paths, update it:

```text
/scaler-task-update T-001 | Add retry policy | ready | src/retry.ts,test/retry.test.ts |  | REQ-004 | Retry succeeds; retry is capped; jitter is used | software | Small isolated retry helper and tests | unit
```

Then continue:

```text
/scaler-step execute
```

### Use case UC-031: add a task manually

```text
/scaler-task-create T-010 | Add CLI smoke test | scripts/,test/ | T-001 | REQ-009 | Smoke command exits 0; output contains status | software | Isolated test-only task | smoke
/scaler-prd-link T-010 | REQ-009
/scaler-validation-add T-010 | smoke | npm run test:smoke | Run smoke test | required | acceptance_smoke | exits 0 | tests:T-010 | host
```

---

## 15. Tool orchestration scenarios

The tool commands are advanced controls for cases where SCALER must request, discover, replay, or schedule tool operations safely.

### Use case UC-032: discover and use a tool safely

Inspect available tools:

```text
/scaler-tool-catalog
/scaler-active-tools catalog
```

Discover a tool schema or behavior:

```text
/scaler-tool-discover read execute tools=read
/scaler-tool-discovery-runs read
```

Run an open tool request:

```text
/scaler-tool-run <requestId> execute
/scaler-tool-transactions <requestId>
```

### Use case UC-033: replay or iterate a failed tool transaction

If a tool transaction failed due to recoverable arguments:

```text
/scaler-tool-replay <transactionId> execute
```

If closed-request replay requires approval:

```text
/scaler-tool-replay-approval approve transaction=<transactionId> reason="safe corrected read-only replay" ttl=1h uses=1
/scaler-tool-replay <transactionId> execute approval=<approvalId>
```

For a bounded correction loop:

```text
/scaler-tool-iteration-policy max=3 auto-replay=on
/scaler-tool-iterate <requestId> execute max=3
/scaler-tool-iteration-runs <requestId>
```

### Use case UC-034: schedule safe parallel tool work

Plan first:

```text
/scaler-tool-schedule parallel=3
```

Execute only when requests are low-risk and independent:

```text
/scaler-tool-schedule execute parallel=3
/scaler-tool-schedules
```

Unknown, risky, or side-effecting work should remain serialized.

---

## 16. Storage and log maintenance

Long runs create logs, reports, caches, archives, and memory. Maintain them deliberately.

### Use case UC-035: inspect and clean storage

Inspect:

```text
/scaler-storage-status
```

Dry-run maintenance:

```text
/scaler-storage-maintain rotate-active min-size=1048576 max-active-bytes=10485760
```

Execute safe maintenance:

```text
/scaler-storage-maintain execute rotate-active min-size=1048576 max-active-bytes=10485760
```

Delete caches only when safe:

```text
/scaler-storage-maintain execute delete-cache
```

Delete archives/raw logs/memory only with explicit intent:

```text
/scaler-storage-maintain execute delete-archives delete-raw-logs delete-memory max-archive-age-days=30 max-raw-log-age-days=14 max-memory-age-days=90
```

### Use case UC-036: schedule storage maintenance

Enable scheduled maintenance:

```text
/scaler-storage-schedule enable interval-hours=24 rotate-active=on compress=on delete-cache=on execute=on
```

Run now:

```text
/scaler-storage-schedule run force
```

Disable:

```text
/scaler-storage-schedule disable
```

---

## 17. Git workflow and finishing a run

SCALER is safest when each validated task is committed or explicitly skipped with a reason.

### Use case UC-005 again: commit validated tasks

```text
/scaler-commit T-001
/scaler-commits T-001
```

If commit is inappropriate:

```text
/scaler-commit-skip T-001 | task produced only transient run evidence
/scaler-commit-skips T-001
```

### Finishing checklist

Run:

```text
/scaler-status
/scaler-tasks
/scaler-prd-status
/scaler-plan-status
/scaler-stage-status
/scaler-budget-status
/scaler-watchdogs
git status --short
```

You want:

- no failed or blocked tasks without a recorded reason;
- no required validation gate unrun;
- no missing PRD coverage for required scope;
- no unaccepted safe replan proposal that should be accepted;
- no unexpected dirty files;
- no hard watchdog/budget event unresolved.

If all tasks are validated and stage transition allows completion, the run can reach `completed`.

---

## 18. Resetting or starting over

### Use case UC-039: reset local runtime state

Use this only when you intentionally want a fresh SCALER run.

Stop Pi first. Then remove local runtime state:

```bash
rm -f .scaler/state.json
rm -rf .scaler/watchdogs
```

For a deeper reset, inspect before deleting:

```bash
find .scaler -maxdepth 2 -type f | sort
```

Potentially remove generated run ledgers too:

```bash
rm -rf .scaler/reports .scaler/checkpoints .scaler/logs .scaler/storage
```

Do not delete `.scaler/prd`, `.scaler/plans`, or `.scaler/knowledge` if you want to keep generated project artifacts.

Start again:

```bash
pi
```

```text
/scaler Build this project from PROJECT-SPEC.md with autonomous validation and commits.
/scaler-stage-workflow execute max=20 research=3 requests=5
```

---

## 19. Scenario command map

This map groups the large SCALER command set by when a user normally needs it.

### Start, status, adaptation

- `/scaler <request>`: create/load run and choose initial complexity.
- `/scaler-status`: compact state and workflow summary.
- `/scaler-adapt [apply]`: adjust stage/complexity based on failures, blockers, uncertainty, budgets.
- `/scaler-pause [reason]`: pause cleanly.
- `/scaler-resume [reason]`: resume after verification.
- `/scaler-resume-check`: verify state, git, logs, memory, checkpoints, budgets.

### Staged autonomous workflow

- `/scaler-stage-workflow [execute] ...`: main PRD/knowledge/planning/replanning coordinator.
- `/scaler-stage-workflow-runs`: inspect coordinator runs.
- `/scaler-stage-status`: inspect artifacts.
- `/scaler-stage-step [execute]`: one stage-conductor step.
- `/scaler-stage-loop [execute] [max=N]`: bounded stage loop.
- `/scaler-stage-run <stage> [execute]`: focused stage child agent.
- `/scaler-stage-runs [stage]`: inspect stage-agent runs.
- `/scaler-stage-record ...`: manually record an artifact.
- `/scaler-stage-validate <stage>` and `/scaler-stage-advance <stage>`: validate/advance artifact readiness.

### PRD, planning, replanning

- `/scaler-prd-status`: runtime PRD coverage.
- `/scaler-plan-status`: current execution plan.
- `/scaler-plan-apply`: apply proposed/current plan tasks.
- `/scaler-planning-reports`: planner-output reports.
- `/scaler-replans`: replan requests.
- `/scaler-replan-request ...`: create request.
- `/scaler-replan-run [execute]`: run replanner.
- `/scaler-replan-runs`: inspect replanner runs.
- `/scaler-replan-proposal-status`: inspect proposed plan.
- `/scaler-replan-accept`: accept safe proposal.
- `/scaler-prd-link <taskId> | <REQs>`: connect task to requirements.

### Task execution

- `/scaler-tasks`: list tasks.
- `/scaler-task-create ...`: create task.
- `/scaler-task-update ...`: update task.
- `/scaler-task-retry ...`: move failed/blocked work back into a retry path.
- `/scaler-task-quality [taskId]`: inspect DoD/path/validation quality.
- `/scaler-step [execute]`: main task execution driver.
- `/scaler-runs [taskId]`: task-agent runs.
- `/scaler-task-reports [taskId]`: accepted task reports.

### Validation and CI/CD

- `/scaler-validation-add ...`: add validation command.
- `/scaler-validation-checklist ...`: add checklist evidence.
- `/scaler-validate [taskId]`: run validation for a task.
- `/scaler-validate-loop [taskId] execute max=N`: bounded validation loop.
- `/scaler-validation-envs`: validation environment records.
- `/scaler-cicd-env ...`: provision CI/CD wrapper/config metadata.
- `/scaler-cicd-envs`: list CI/CD environment records.

### Debugging and retry

- `/scaler-debug-run [taskId] [execute]`: focused debug agent.
- `/scaler-debug-loop [taskId] execute max=N`: debug conductor.
- `/scaler-debug-runs [taskId]`: inspect debug runs.
- `/scaler-debug-reports`: inspect reports.
- `/scaler-debug-retry [taskId] [execute]`: exact retry path.
- `/scaler-debug-retry-policy ...`: configure retry automation.
- `/scaler-debug-retry-approve ...`: approve retry.
- `/scaler-debug-retry-approvals`: inspect approvals.
- `/scaler-debug-retries`: inspect retry records.

### Context, memory, missing data, research

- `/scaler-context-init [taskId]`: initialize task context manifest.
- `/scaler-context-status [taskId]`: inspect context.
- `/scaler-context-candidates [taskId] ...`: find candidates.
- `/scaler-context-approve ...`: approve candidate.
- `/scaler-context-splits [taskId]`: inspect context split artifacts.
- `/scaler-compact`: request SCALER-aware compaction.
- `/scaler-compactions`: list compaction records.
- `/scaler-context-handoff ...`: prepare minimal fresh-context handoff.
- `/scaler-context-handoffs ...`: list handoffs.
- `/scaler-memory-search ...`: search memory.
- `/scaler-missing-context [taskId]`: list missing requests.
- `/scaler-missing-context-run ...`: resolve by agents/research.
- `/scaler-missing-context-resolve ...`: manual resolution.
- `/scaler-research-request ...`: create research request.
- `/scaler-research-run ...`: run research agent.
- `/scaler-research-web ...`: run web research workflow.
- `/scaler-research-report ...`: record manual research result.
- `/scaler-research-status`, `/scaler-research-runs`, `/scaler-research-transactions`: inspect research.

### Safety, budget, watchdogs

- `/scaler-safety-policy ...`: configure allowed risk classes.
- `/scaler-safety-approval ...`: approve/revoke one-off risky actions.
- `/scaler-safety-scan [execute] ...`: run dependency/image scanners.
- `/scaler-budget-policy ...`: apply complexity-based budgets.
- `/scaler-budget-status`: inspect budget state.
- `/scaler-budget-set ...`: set soft/hard limits.
- `/scaler-watchdogs [execute]`: assess/pause on hard triggers.
- `/scaler-heartbeat ...`: record/list heartbeats.
- `/scaler-watchdog-cleanup`: inspect cleanup evidence.

### Tools and MCP

- `/scaler-tool-catalog [toolName]`: known tool catalog.
- `/scaler-active-tools [catalog|focus|restore]`: active Pi tools.
- `/scaler-tool-discover ...`: discover/probe tool schema.
- `/scaler-tool-discovery-runs ...`: inspect discovery.
- `/scaler-tool-run ...`: execute tool request.
- `/scaler-tool-transactions ...`: inspect transactions.
- `/scaler-tool-replay ...`: replay transaction.
- `/scaler-tool-replay-approval ...`: approve closed replay.
- `/scaler-tool-iteration-policy ...`: configure correction loop.
- `/scaler-tool-iterate ...`: iterate request.
- `/scaler-tool-iteration-runs ...`: inspect iterations.
- `/scaler-tool-schedule ...`: plan/execute safe parallel tool work.
- `/scaler-tool-schedules ...`: inspect schedules.
- `/scaler-mcp-enumerate`: enumerate MCP config without running servers.
- `/scaler-mcp-servers [name|runs]`: inspect MCP records.

### Storage and git

- `/scaler-storage-status`: scan `.scaler/` storage.
- `/scaler-storage-maintain ...`: rotate/compress/delete approved storage.
- `/scaler-storage-schedule ...`: scheduled maintenance.
- `/scaler-git-bootstrap`: git safety/bootstrap records.
- `/scaler-commit [taskId]`: commit validated task.
- `/scaler-commits [taskId]`: inspect commit records.
- `/scaler-commit-skip ...`: record non-commit reason.
- `/scaler-commit-skips [taskId]`: inspect skips.
- `/scaler-lock`: inspect execution lock.
- `/scaler-lock-clear <reason>`: clear stale lock.

---

## Recommended first autonomous session

If you only want the shortest practical recipe, use this:

```text
/scaler Build this project from PROJECT-SPEC.md. Operate autonomously, validate every task, preserve validated progress, and ask only for missing context or risky external approval.
/scaler-budget-policy level=4 approve
/scaler-stage-workflow execute max=20 research=3 requests=5 internet auto-accept-replan=on
/scaler-status
/scaler-tasks
/scaler-step execute
/scaler-validate-loop T-001 execute max=3
/scaler-commit T-001
```

Then repeat the middle commands according to status:

```text
/scaler-stage-workflow execute max=20 research=3 requests=5 internet auto-accept-replan=on
/scaler-step execute
/scaler-validate-loop <taskId> execute max=3
/scaler-commit <taskId>
```

When something blocks, jump to the scenario section that matches the block.
