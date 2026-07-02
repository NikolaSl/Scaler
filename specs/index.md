# SCALER Specs Index

Use this index when implementing Scaler.

It tells coding agents which spec files to read for each implementation task. These specs are not runtime LLM context by default. Algorithmic components, like the supervisor FSM, read state and reports at runtime, not spec files.

| Spec | Load when working on |
| --- | --- |
| `supervisor.md` | FSM, state, transitions, report acceptance |
| `adaptive-orchestration.md` | complexity levels, when to escalate/de-escalate |
| `pi-extension-architecture.md` | mapping requirements to Pi APIs, implementation phases |
| `context-selection.md` | context manifests, pre-spawn context resolver, missing data |
| `task-agents.md` | task-agent prompt/input/report contract, task sizing |
| `memory.md` | `.scaler/memory`, memory index, retrieval rules |
| `logging.md` | `.scaler/logs`, audit events, log format |
| `storage.md` | compression, rotation, storage limits |
| `budgets-watchdogs.md` | token/cost/time/tool/storage budgets, checkpoints, resume |
| `tool-mcp-safety.md` | structured tool requests, isolated tool/MCP agents |
| `safety-permissions.md` | protected paths, approvals, secrets, sandbox exceptions |
| `research.md` | local/internet research, source quality, completeness |
| `validation.md` | validation gates, validation reports, acceptance rules |
| `cicd-environment.md` | Docker, Compose, dev containers, Minikube validation |
| `attempt-tracking.md` | failure records, attempt signatures, debug loops |
| `replanning.md` | plan versions, POC tasks, preserving progress |
| `runtime-prd-ledger.md` | runtime polished PRD ledger, requirement coverage, task links, PRD versions |
| `git-workflow.md` | repo setup, per-task commits, dirty tree handling |

## Minimal implementation loading rule

For implementation agents, load:

1. `assignement.md` relevant section.
2. This index.
3. Only specs directly listed for the current implementation task.

Do not load all specs unless doing full PRD review.

## Runtime rule

At runtime, Scaler should pass agents only the minimal task context selected by the context resolver. Specs are implementation references, not automatic runtime context.
