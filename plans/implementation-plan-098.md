# Implementation Plan 098: Active-run mutation guardrail

## Gap
A real eThIME dry run showed a critical workflow escape hatch: after staged planning, project implementation files were written from the parent session while SCALER state still showed `stage=planning`, `currentTaskId=null`, and all planned tasks pending. That bypassed task context manifests, task-agent isolation, validation handoffs, commit gates, and transition traceability.

## Scope
- [x] IMPL-367: Block direct parent-session project mutations whenever a SCALER run is active and no current task with explicit `allowedPathPrefixes` exists.
- [x] IMPL-367: Keep stage agents explicitly report/artifact scoped: they must not implement product code, install dependencies, commit, or continue into task execution after reporting the stage artifact.

## Implementation
- Safety policy now supports active-run overlays: `requireAllowedPathPrefixesForWrite` and `allowBashProjectMutations`.
- The extension `tool_call` hook enables those overlays for active SCALER stages. During active runs, direct `write`/`edit` requires an active task and allowed paths; common mutating `bash` commands are blocked without a current task.
- Stage-agent prompts now explicitly say they are not task implementation agents and must stop after report/tool emission.

## Validation
- `npm run build`
- `node --test --import tsx test/safety.test.ts test/stage-agents.test.ts test/integration/mock/safety-hook-flow.test.ts`

## Follow-up
The eThIME repository should be treated as contaminated from a SCALER-traceability perspective. Either reset and rerun through fixed SCALER, or manually salvage the code into atomic tasks/commits with explicit repair notes that the original implementation was not SCALER-generated through the intended path.
