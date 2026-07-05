# SCALER tutorial use-case tracker

This file tracks the tutorial contents and the scenario coverage expected from [`tutorial/index.md`](index.md).

## Section tracker

| Section | Topic | Main outcome | Status |
|---|---|---|---|
| [S01](index.md#1-what-scaler-is-doing) | First mental model | Understand what SCALER stores, what Pi stores, and why most commands are for recovery/control | Covered |
| [S02](index.md#2-before-your-first-run) | Before first run | Prepare repo, specs, trust, model, git, ignore runtime files | Covered |
| [S03](index.md#3-full-automation-from-a-base-specification) | Full autonomous run | Start from a base specification and drive PRD -> knowledge -> planning -> execution -> validation -> commit | Covered |
| [S04](index.md#4-monitoring-while-automation-is-running) | Live monitoring | Inspect status without taking over the run | Covered |
| [S05](index.md#5-normal-interaction-while-work-is-in-progress) | Normal interaction | Pause, steer, add context, add validation, approve safe policies | Covered |
| [S06](index.md#6-resume-after-pi-exits-crashes-or-the-computer-restarts) | Resume after interruption | Continue after Pi exit, crash, terminal close, computer restart | Covered |
| [S07](index.md#7-when-progress-stalls-heartbeats-and-watchdogs) | Stalled or no-progress run | Use heartbeats/watchdogs/checkpoints | Covered |
| [S08](index.md#8-budgets-complexity-and-approvals) | Budget and complexity problems | Inspect limits, approve high complexity, reduce scope | Covered |
| [S09](index.md#9-missing-context-memory-and-research) | Missing context and research | Resolve missing data, internet research, memory search | Covered |
| [S10](index.md#10-validation-failures-debugging-and-retry) | Validation, debug, retry | Failed validation -> focused debug -> exact rerun -> full validation | Covered |
| [S11](index.md#11-safety-internet-external-tools-and-scans) | Safety and external tools | Internet, external services, destructive commands, scanners, approvals | Covered |
| [S12](index.md#12-cicd-and-validation-environments) | CI/CD and environments | Docker/Compose/devcontainer/local CI validation wrappers | Covered |
| [S13](index.md#13-replanning-without-losing-validated-progress) | Planning and replanning | Coverage gaps, accepted proposals, preserving validated work | Covered |
| [S14](index.md#14-task-quality-and-manual-task-repair) | Task quality and task repair | DoD, allowed paths, atomicity, validation refs, waivers | Covered |
| [S15](index.md#15-tool-orchestration-scenarios) | Tool orchestration | Tool requests, discovery, transactions, replay, scheduling | Covered |
| [S16](index.md#16-storage-and-log-maintenance) | Storage and logs | Maintain `.scaler/` storage without losing important evidence | Covered |
| [S17](index.md#17-git-workflow-and-finishing-a-run) | Git and finishing | Bootstrap ignore rules, commit validated tasks, finish criteria | Covered |
| [S18](index.md#18-resetting-or-starting-over) | Reset and cleanup | Start over safely | Covered |
| [S19](index.md#19-scenario-command-map) | Command map | Scenario-oriented map of the large command set | Covered |
| [S20](diagrams.md) | Orchestration diagrams | GitHub-renderable Mermaid diagrams for FSMs, agents, tools, context, and recovery | Covered |

## Use-case tracker

| ID | Use case | Primary commands | Tutorial section | Status |
|---|---|---|---|---|
| UC-001 | Install/load SCALER and verify Pi sees it | `pi`, `/scaler-status` | [S02](index.md#2-before-your-first-run) | Covered |
| UC-002 | Start from a base project specification | `/scaler`, `/scaler-stage-workflow execute` | [S03](index.md#3-full-automation-from-a-base-specification) | Covered |
| UC-003 | Run staged automation repeatedly until all stage artifacts exist | `/scaler-stage-workflow`, `/scaler-stage-status`, `/scaler-status` | [S03](index.md#3-full-automation-from-a-base-specification) | Covered |
| UC-004 | Execute implementation tasks autonomously | `/scaler-step execute`, `/scaler-runs`, `/scaler-task-reports` | [S03](index.md#3-full-automation-from-a-base-specification) | Covered |
| UC-005 | Validate and commit completed tasks | `/scaler-validate-loop execute`, `/scaler-commit` | [S03](index.md#3-full-automation-from-a-base-specification)/[S17](index.md#17-git-workflow-and-finishing-a-run) | Covered |
| UC-006 | Know when the work is done | `/scaler-status`, `/scaler-tasks`, `/scaler-prd-status`, `/scaler-plan-status` | [S03](index.md#3-full-automation-from-a-base-specification)/[S17](index.md#17-git-workflow-and-finishing-a-run) | Covered |
| UC-007 | Check status during a long run | `/scaler-status`, `/scaler-stage-status`, `/scaler-tasks`, `/scaler-budget-status` | [S04](index.md#4-monitoring-while-automation-is-running) | Covered |
| UC-008 | Inspect generated PRD/planning/research artifacts | `/scaler-prd-status`, `/scaler-plan-status`, `/scaler-research-status`, `/scaler-stage-workflow-runs` | [S04](index.md#4-monitoring-while-automation-is-running) | Covered |
| UC-009 | Pause cleanly before leaving | `/scaler-pause` | [S05](index.md#5-normal-interaction-while-work-is-in-progress) | Covered |
| UC-010 | Add or correct validation while work is running | `/scaler-validation-add`, `/scaler-validation-checklist` | [S05](index.md#5-normal-interaction-while-work-is-in-progress)/[S10](index.md#10-validation-failures-debugging-and-retry) | Covered |
| UC-011 | Resume after terminal close or reboot | `pi`, `/scaler-resume-check`, `/scaler-resume` | [S06](index.md#6-resume-after-pi-exits-crashes-or-the-computer-restarts) | Covered |
| UC-012 | Recover when the Pi process died during a task agent | `/scaler-lock`, `/scaler-lock-clear`, `/scaler-runs`, `/scaler-step execute` | [S06](index.md#6-resume-after-pi-exits-crashes-or-the-computer-restarts) | Covered |
| UC-013 | Verify the run is not stale | `/scaler-heartbeat list`, `/scaler-watchdogs` | [S07](index.md#7-when-progress-stalls-heartbeats-and-watchdogs) | Covered |
| UC-014 | Pause on hard watchdog trigger | `/scaler-watchdogs execute` | [S07](index.md#7-when-progress-stalls-heartbeats-and-watchdogs) | Covered |
| UC-015 | Approve high-complexity budget policy | `/scaler-budget-policy level=N approve` | [S08](index.md#8-budgets-complexity-and-approvals) | Covered |
| UC-016 | Set token/cost/tool limits | `/scaler-budget-set`, `/scaler-budget-status` | [S08](index.md#8-budgets-complexity-and-approvals) | Covered |
| UC-017 | Reduce scope after budget pressure | `/scaler-adapt apply`, `/scaler-replan-request` | [S08](index.md#8-budgets-complexity-and-approvals)/[S13](index.md#13-replanning-without-losing-validated-progress) | Covered |
| UC-018 | Find existing knowledge before asking the model to research | `/scaler-memory-search`, `/scaler-context-candidates` | [S09](index.md#9-missing-context-memory-and-research) | Covered |
| UC-019 | Resolve missing context from files/memory/research/manual evidence | `/scaler-missing-context`, `/scaler-missing-context-run`, `/scaler-missing-context-resolve` | [S09](index.md#9-missing-context-memory-and-research) | Covered |
| UC-020 | Use web/internet research intentionally | `/scaler-research-request`, `/scaler-research-web execute internet` | [S09](index.md#9-missing-context-memory-and-research)/[S11](index.md#11-safety-internet-external-tools-and-scans) | Covered |
| UC-021 | Handle validation failure | `/scaler-validate`, `/scaler-debug-run execute`, `/scaler-debug-loop execute` | [S10](index.md#10-validation-failures-debugging-and-retry) | Covered |
| UC-022 | Retry only the failed validation after a fix | `/scaler-debug-retry`, `/scaler-debug-retry-approve` | [S10](index.md#10-validation-failures-debugging-and-retry) | Covered |
| UC-023 | Configure retry automation safely | `/scaler-debug-retry-policy` | [S10](index.md#10-validation-failures-debugging-and-retry) | Covered |
| UC-024 | Allow internet/external/sandbox behavior by policy | `/scaler-safety-policy`, `/scaler-safety-approval` | [S11](index.md#11-safety-internet-external-tools-and-scans) | Covered |
| UC-025 | Run security/dependency scans | `/scaler-safety-scan execute` | [S11](index.md#11-safety-internet-external-tools-and-scans) | Covered |
| UC-026 | Prepare CI/CD validation environment metadata | `/scaler-cicd-env`, `/scaler-validation-envs` | [S12](index.md#12-cicd-and-validation-environments) | Covered |
| UC-027 | Run local CI in declared non-host environments | `/scaler-validation-add`, `/scaler-validate-loop execute` | [S12](index.md#12-cicd-and-validation-environments) | Covered |
| UC-028 | Accept safe replanning proposal | `/scaler-replan-run execute`, `/scaler-replan-proposal-status`, `/scaler-replan-accept` | [S13](index.md#13-replanning-without-losing-validated-progress) | Covered |
| UC-029 | Create manual replan request when assumptions change | `/scaler-replan-request` | [S13](index.md#13-replanning-without-losing-validated-progress) | Covered |
| UC-030 | Repair task quality issues before execution | `/scaler-task-quality`, `/scaler-task-update` | [S14](index.md#14-task-quality-and-manual-task-repair) | Covered |
| UC-031 | Add a task manually | `/scaler-task-create`, `/scaler-prd-link` | [S14](index.md#14-task-quality-and-manual-task-repair) | Covered |
| UC-032 | Discover and use a tool safely | `/scaler-tool-catalog`, `/scaler-tool-discover`, `/scaler-tool-run` | [S15](index.md#15-tool-orchestration-scenarios) | Covered |
| UC-033 | Replay or iterate failed tool transaction | `/scaler-tool-replay`, `/scaler-tool-iterate` | [S15](index.md#15-tool-orchestration-scenarios) | Covered |
| UC-034 | Schedule safe parallel tool work | `/scaler-tool-schedule` | [S15](index.md#15-tool-orchestration-scenarios) | Covered |
| UC-035 | Clean large SCALER storage/logs | `/scaler-storage-status`, `/scaler-storage-maintain` | [S16](index.md#16-storage-and-log-maintenance) | Covered |
| UC-036 | Schedule routine storage maintenance | `/scaler-storage-schedule` | [S16](index.md#16-storage-and-log-maintenance) | Covered |
| UC-037 | Bootstrap git ignore/status evidence | `/scaler-git-bootstrap` | [S17](index.md#17-git-workflow-and-finishing-a-run) | Covered |
| UC-038 | Skip commit with evidence when commit is not appropriate | `/scaler-commit-skip`, `/scaler-commit-skips` | [S17](index.md#17-git-workflow-and-finishing-a-run) | Covered |
| UC-039 | Reset SCALER runtime state for a fresh run | shell `rm -rf .scaler/...`, `/scaler` | [S18](index.md#18-resetting-or-starting-over) | Covered |
| UC-040 | Find the right command quickly | Command map appendix | [S19](index.md#19-scenario-command-map) | Covered |
| UC-041 | Understand the whole orchestration visually | `tutorial/diagrams.md` Mermaid diagrams | [S20](diagrams.md) | Covered |
