# SCALER Integration Test Suite

This folder contains SCALER integration tests. They exercise multi-module workflows against temporary repositories and persisted `.scaler/` artifacts so orchestration regressions are caught outside unit tests.

## Suite layout

- Unit/component tests live in `test/*.test.ts`.
- Deterministic mocked integration tests live in `test/integration/mock/*.test.ts`.
- Optional real Pi/model contract tests live in `test/integration/real/*.test.ts`.

Scripts:

```bash
npm test                         # unit + mocked integration
npm run test:unit                # unit tests only
npm run test:integration         # mocked integration (default integration suite)
npm run test:integration:mock    # mocked integration only
npm run test:integration:real    # real suite only; skipped unless enabled
npm run build
```

The default `npm test` path must remain deterministic and must not call real LLMs or the real `pi` executable.

## Requirement sources

Integration scenarios should be designed from source requirements, not only from current implementation behavior. Review:

1. `assignement.md`
2. relevant `specs/*.md`
3. `requirements-catalog.md`
4. `traceability-matrix.md`
5. manual pages for implemented behavior

The goal is to test that the implemented system still matches the intended SCALER workflow.

## Standard integration test shape

A good integration test should:

1. create a temporary repository with `mkdtemp`;
2. initialize git if workflow/git behavior matters;
3. create realistic project files such as `package.json`, source files, and validation scripts;
4. call public SCALER workflow functions or command handlers across module boundaries;
5. use deterministic mock child-agent runners in `test/integration/mock/`;
6. assert persisted `.scaler/` artifacts, not only returned function values;
7. assert structured-only ingestion behavior where child-agent output is involved;
8. clean up the temp repo in `finally`.

Prefer assertions on durable artifacts such as:

- `.scaler/state.json`
- `.scaler/debug/failures.json`
- `.scaler/debug/attempts.json`
- `.scaler/debug/reports.json`
- `.scaler/debug/retries.json`
- `.scaler/debug/retry-policy.json`
- `.scaler/debug/retry-approvals.json`
- `.scaler/research/requests.json`
- `.scaler/research/reports.json`
- `.scaler/research/transactions.json`
- `.scaler/context/missing-requests.json`
- `.scaler/context/splits.json`
- `.scaler/context/compactions.json`
- `.scaler/context/handoffs.json`
- `.scaler/watchdogs/heartbeats.json`
- `.scaler/watchdogs/events.json`
- `.scaler/watchdogs/cleanup.json`
- `.scaler/watchdogs/resume-checks.json`
- `.scaler/tool-requests/requests.json`
- `.scaler/tool-requests/results.json`
- `.scaler/tool-requests/transactions.json`
- `.scaler/tool-requests/catalog.json`
- `.scaler/tool-requests/schema-runs.json`
- `.scaler/tool-requests/mcp-servers.json`
- `.scaler/tool-requests/replay-approvals.json`
- `.scaler/tool-requests/iteration-policy.json`
- `.scaler/tool-requests/iteration-runs.json`
- `.scaler/tool-requests/schedules.json`
- `.scaler/plans/replan-requests.json`
- `.scaler/reports/task-quality.json`
- `.scaler/reports/validation-runs.json`
- `.scaler/reports/validation-checklists.json`
- `.scaler/reports/validation-environments.json`
- `.scaler/reports/*-agent-runs.json`
- `.scaler/reports/stage-workflow-runs.json`
- `.scaler/logs/events.jsonl`
- `.scaler/stages/stage-artifacts.json`
- `.scaler/knowledge/knowledge-report.md`
- `.scaler/plans/current-plan.json`
- `.scaler/plans/proposed-plan.json`
- `.scaler/plans/replan-decisions.json`
- `.scaler/storage/index.json`
- `.scaler/storage/maintenance.json`
- `.scaler/storage/schedule.json`
- `.scaler/safety/policy.json`
- `.scaler/safety/approvals.json`
- `.scaler/safety/scans.json`

## Mock child-agent runners

Mocked integration tests must not call real LLMs or the real `pi` binary. Use mock runners with the same shape as `runTaskAgent`:

```ts
async function mockRunner(request: TaskAgentRequest): Promise<TaskAgentRunResult> {
  return {
    taskId: request.taskId,
    exitCode: 0,
    stdoutEvents: [{ type: "scaler_debug_report", taskId: "T-001", status: "next_approach", summary: "...", nextApproach: "..." }],
    stderr: "",
    timedOut: false,
    aborted: false,
    // Optional: include provider usage when a scenario needs token/cost budget accounting.
    // usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, costMicros: 50, sources: ["mock"] },
  };
}
```

Use scripted mock runners when a scenario needs multiple child-agent turns. Example: first debug-agent call returns `needs_research`; second debug-agent call returns `next_approach` after a research report is ingested.

## Structured-only ingestion tests

SCALER must not ingest arbitrary child-agent prose as state. For each child-agent report type, integration coverage should feed free-form/unparsed output and verify:

- the run record may exist;
- ingestion is attempted and rejected;
- no state/report ledger is mutated as if the prose were valid.

Current mocked coverage includes negative cases for debug, stage, replan, and research agent outputs.

## Optional real Pi/model mode

Real tests are separate from the deterministic mock suite and are skipped unless explicitly enabled:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=openai-codex/gpt-5.3-codex-spark \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm run test:integration:real
```

Prefer provider-qualified model names such as `openai-codex/gpt-5.3-codex-spark` when `/model` shows a provider. Unqualified names can resolve to a different provider in non-interactive subprocesses. The helper script `scripts/run-real-integration.sh` uses the provider-qualified Codex model by default.

Real Pi/model tests are opt-in because they can cost tokens, depend on local/provider configuration, and are less deterministic than mock tests. They should validate narrow real-boundary contracts only; do not make them depend on external network access.

Current real mode has three layers:

1. child-agent structured-output contracts that call real Pi/model subprocesses and verify SCALER report extraction;
2. real Pi extension integrity tests that launch `pi --mode json -p --no-session -e <src/index.ts>` in a temporary repository and verify extension command dispatch, SCALER tool calls, safety hooks, safety policy/approval persistence, `.scaler/logs/events.jsonl`, detail payload references, and persisted state; and
3. real flow-parity chains that run real Pi/model child agents through SCALER's normal debug, research, stage, and replanner pathways while asserting persisted ledgers.

Command-dispatch extension tests may avoid model output. Current real command coverage also includes strict task creation/task-quality review, context-split/fresh-handoff, compaction-record listing, watchdog heartbeat/status/cleanup, resume-check, and budget-policy approval so supervisor boundary ledgers are exercised without requiring expensive model summarization. Cardinal SCALER-tool and hook tests use the selected real model with restricted `--tools` lists. Child-agent invocation is deny-by-default: omitted or empty tool lists become `--no-tools`, and granted-tool child invocations include the SCALER extension unless an explicit extension path is supplied. Report-only child-agent flow tests assert `--no-tools` so the real model cannot mutate the temporary repository outside the expected structured report.

## Cardinal instruction pattern for real mode

When a test uses a real model, prepend a cardinal instruction to the prompt. The cardinal instruction must make the expected output deterministic even if the rest of the context contains other instructions.

Structured-report pattern:

```text
CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {...}.
```

Tool-call pattern:

```text
CARDINAL INSTRUCTION FOR THIS TEST: You must call the tool <tool_name> exactly once with exactly these arguments and no other tool calls: {...}. Do not answer in prose before the tool call.
```

Rules:

- Put the cardinal instruction before the ordinary agent prompt.
- Also pass it as `extraInstructions` when supported so it appears in the generated prompt detail.
- Require exactly one JSON event or exactly one named tool call, depending on the scenario.
- For structured report contracts, require no prose/markdown.
- For negative structured-ingestion tests, a cardinal-only real Pi prompt may be used so the model cannot repair the intentionally invalid output from the ordinary agent prompt.
- For tool/hook contracts, restrict `--tools` to the single required tool whenever possible.
- Include all fields needed for deterministic ingestion or ledger mutation.
- SCALER accepts report events either as direct mock `scaler_*` objects or as exact JSON objects in assistant text inside Pi `--mode json` event wrappers; surrounding prose/markdown remains rejected.
- Keep the event/tool call small and cheap.
- Do not require real external network access.

If a model cannot follow this instruction reliably, treat that as a model/configuration issue; do not weaken default mock tests.

## Adding a new integration test

When adding a new integration scenario:

1. Put deterministic tests under `test/integration/mock/<scenario>.test.ts`.
2. Put opt-in real subprocess/model contracts under `test/integration/real/<scenario>.test.ts`.
3. Use deterministic temp repo setup.
4. Prefer mock runners; add optional real mode only when it increases confidence.
5. Assert returned results and persisted artifacts.
6. Add structured-only negative coverage if a child report is ingested.
7. Update this README when adding a new pattern or environment variable.
8. Update `manual/testing.md`, `implementation-inventory.md`, and `traceability-matrix.md` if coverage changes.
9. Run `npm test` and `npm run build`.

## Current mocked scenarios

- `mock/debug-research-flow.test.ts`
  - conductor execution into structured task-agent report ingestion before validation handoff, including missing/invalid report blocking;
  - task-definition quality reviews for missing Definition of Done, validation, and allowed path scope;
  - failing validation into debugging;
  - cyclic debug attempts and retry-gate refusal;
  - debug-agent `needs_research` report ingestion;
  - research-agent report ingestion and request resolution;
  - debug-agent `next_approach` report ingestion;
  - retry-gate clearance by later `newEvidence`;
  - rejection of free-form debug-agent output.
- `mock/debug-conductor-flow.test.ts`
  - bounded debug conductor from failed validation through debug `needs_research` → research completion → debug `next_approach`;
  - validation-debug workflow from actual validation failure through debug/research loop after the validation lock is released;
  - bounded debug conductor from debug `needs_replan` → replanner proposal staging without automatic acceptance.
- `mock/debug-retry-flow.test.ts`
  - failed validation creates a debugging task;
  - accepted debug `next_approach` feeds a supervised retry task-agent prompt;
  - retry policy can auto-start the retry from the bounded debug conductor;
  - exact previously failing validation passes before optional full validation marks the task validated;
  - retry policy, approval records, retry records, debug attempts, validation runs, and audit logs are persisted.
- `mock/stage-replan-plan-flow.test.ts`
  - stage conductor loop from PRD through knowledge, planning, execution, and completion;
  - stage-agent structured artifact ingestion, readiness, semantic, consistency, advancement, run records, and audit logs;
  - runtime PRD requirements plus planner-report PRD/plan/task synchronization and coverage-gap replan request;
  - replanner-agent structured proposal ingestion, preservation checks, proposed-plan persistence, run records, and audit logs;
  - replan proposal acceptance, current-plan replacement, version snapshot, replan decision, request resolution, and task creation;
  - validated-task git commit through the execution lock while preserving `.scaler/` runtime artifacts and recording git audit logs plus post-commit report artifacts.
  - git bootstrap/status rules, pre-task dirty-tree checkpoints, validation commit-required ordering, and explicit commit-skip promotion.
- `mock/budget-command-flow.test.ts`
  - provider usage turn metadata increments token/cost budget counters and writes budget audit events;
  - command-driven budget configuration persisted to state;
  - configured validation-loop hard stop before validation command execution, with pause/audit behavior.
- `mock/storage-status-flow.test.ts`
  - command-driven `.scaler/` storage inventory persistence;
  - configured storage hard limit pauses the run and records budget/state audit events.
- `mock/safety-hook-flow.test.ts`
  - persisted safety-policy allowances for external/internet classes;
  - scoped safety approval creation and one-use consumption by the tool-call hook;
  - bounded sandbox destructive-command exceptions and host-mount refusal;
  - dry-run security scanner candidate records;
  - external mutation and secret-environment hook blocking plus safety audit events.
- `mock/storage-maintenance-flow.test.ts`
  - command-driven storage maintenance execution compresses eligible `.scaler/reports/` files;
  - explicit `.scaler/cache/` cleanup deletes only cache files;
  - scheduled maintenance command due checks persist `.scaler/storage/schedule.json`, dry-run maintenance reports, storage budget usage, and audit logs;
  - approved archive, raw log detail, and memory retention deletion preserve non-selected files and prune deleted memory index entries;
  - persisted maintenance reports, storage budget usage, and command/state audit logs are asserted.
- `mock/research-internet-grant-flow.test.ts`
  - internet tools are withheld until explicit grants are supplied;
  - web research workflow discovers browser/search/MCP tools from schema records;
  - multi-query research transactions and source freshness/version review records are persisted.
- `mock/tool-request-flow.test.ts`
  - rich `scaler_tool_request` metadata persists to `.scaler/tool-requests/`;
  - isolated invocation includes only explicitly allowed tools and selected compact catalog entries, with no-tool default child invocations when no grant exists;
  - discovered `scaler_tool_schema` metadata is merged into later request/transaction prompts;
  - project-local MCP server declarations are enumerated into `.scaler/tool-requests/mcp-servers.json` without executing servers or storing env secret values;
  - supervised schema discovery probes record prepare/execute runs under `.scaler/tool-requests/schema-runs.json` and require structured `scaler_tool_schema` completion;
  - tool-agent transactions record prepare/execute/replay runs under `.scaler/tool-requests/transactions.json`;
  - exact closed replay approvals record `.scaler/tool-requests/replay-approvals.json`, keep closed replays rejected by default, and consume approval use counts when supplied explicitly;
  - bounded tool iteration workflow records `.scaler/tool-requests/iteration-runs.json`, replays latest `missing_result` transactions, and stops on structured closure or cap exhaustion;
  - safe tool scheduling records `.scaler/tool-requests/schedules.json`, parallelizes only low-risk/read-only requests, serializes risky requests, and still requires structured result closure;
  - free-form/missing child results become `missing_result` instead of request completion, and replay can close only through structured results;
  - structured `scaler_tool_result` closes the originating request and persists outputs/evidence/validation metadata.
- `mock/validation-gates-flow.test.ts`
  - command-driven typed validation gate metadata persisted to manifests;
  - validation run records and audit events preserve gate, required, expected-result, evidence metadata, environment metadata, and dependency/test-first/CI-sandbox policy diagnostics;
  - declared local-CI validation records prepare/cleanup lifecycle evidence, generated CI/CD wrapper/provision records, and `/scaler-validation-envs` plus `/scaler-cicd-envs` status output;
  - misordered required dependency checks and undeclared local-CI host execution fail before expensive validation commands execute;
  - command-driven non-software validation checklists persist deterministic checklist records, apply fail/pass rollups, and enforce evidence-required acceptance policy.
- `mock/research-internet-grant-flow.test.ts`
  - internet-scope research requests withhold child-agent tools until an explicit internet grant is supplied;
  - explicit grants pass only the listed tools, load the SCALER child extension for safety hooks, preserve source URL metadata, raw evidence memory refs, run records, and agent prompt audit details.
- `mock/safety-hook-flow.test.ts`
  - extension `tool_call` hook blocks external publish and secret environment exposure commands;
  - persisted safety policy allows configured internet/external command classes while preserving secret blocks;
  - persisted safety audit logs record blocked risks.
- `mock/remaining-flows.test.ts`
  - budget hard stops for conductor and validation plus pause/audit behavior;
  - context discovery into conductor prompts, including exactness/compression guidance and automatic context-split artifacts;
  - structured-only rejection for stage, replan, and research agents;
  - unsafe replan proposal acceptance rejection;
  - debug report to replan request to acceptance retry-gate clearance;
  - blocked validation to replan proposal acceptance;
  - execution-lock contention across conductor, validation, stage, replan, research, debug, and commit workflows;
  - safety/allowed-path and commit-refusal chains, git bootstrap/pre-task dirty-tree checkpoints, and commit-skip acceptance ordering;
  - research raw evidence memory references, memory search/tag filtering, and summary-scoped memory context in later context;
  - stage consistency rejection;
  - dependency-blocked task selection and release after dependency validation.

## Current real scenarios

- `real/real-pi-contracts.test.ts`
  - opt-in cardinal structured-output contract for `scaler_debug_report`;
  - opt-in cardinal structured-output contract for `scaler_research_report`;
  - opt-in cardinal internet-scope research grant contract that passes only the listed tool and persists source URL metadata;
  - opt-in cardinal structured-output contract for `scaler_stage_artifact`;
  - opt-in cardinal structured-output contract for `scaler_replan_proposal`;
  - real Pi `--mode json` wrapper extraction for exact assistant JSON events.
- `real/real-pi-extension-integrity.test.ts`
  - real Pi extension load and slash-command dispatch via `/scaler-lock`;
  - real Pi provider usage turn metadata updating `contextTokens`/`estimatedCostMicros` and budget audit logs;
  - real Pi slash-command budget configuration/status persistence;
  - real Pi slash-command storage status inventory persistence;
  - real Pi slash-command storage maintenance execution, scheduled maintenance due checks, active-ledger rotation, and approved archive/raw-log/memory retention deletion with persisted `.scaler/storage/maintenance.json`/`schedule.json` and audit logs;
  - real Pi slash-command safety-policy persistence;
  - real Pi `tool_result` large-output externalization into `.scaler/logs/tools/` with redacted audit details;
  - real Pi slash-command debug next-approach retry prepare mode with persisted `.scaler/debug/retries.json` and prompt audit logs;
  - real Pi slash-command MCP enumeration, tool transaction, transaction replay, replay approval, schedule planning, and bounded iteration prepare modes with persisted `.scaler/tool-requests/mcp-servers.json` / `.scaler/tool-requests/transactions.json` / `.scaler/tool-requests/replay-approvals.json` / `.scaler/tool-requests/schedules.json` / `.scaler/tool-requests/iteration-runs.json`, plus tool iteration policy persistence;
  - real Pi slash-command typed validation gate metadata, validation gate/environment/disposition policy enforcement, validation environment lifecycle status, deterministic CI/CD sandbox provisioning/status, skipped/blocked disposition persistence, non-software checklist persistence, evidence-policy enforcement, git bootstrap evidence, and commit-skip promotion after passed validation;
  - command audit events and detail payload references in `.scaler/logs/events.jsonl`;
  - cardinal real-model call to `scaler_tool_request` with exact rich metadata and persisted tool-request state;
  - cardinal real-model call to `scaler_tool_result` with exact result metadata, persisted result ledger, and closed request status;
  - cardinal real-model call to `scaler_task_create` with exact arguments and persisted SCALER task state;
  - cardinal real-model call to built-in `bash` with `npm publish --dry-run`, blocked by SCALER's external safety hook and recorded as a safety audit event;
  - cardinal real-model call to built-in `bash` with `cat .env`, blocked by SCALER's protected-path safety hook and recorded as a safety audit event.
  - cardinal real-model call to built-in `bash` with large stdout, externalized by the `tool_result` hook and recorded as a tool audit event.
- `real/real-pi-debug-conductor.test.ts`
  - opt-in real Pi/model validation-debug workflow from actual failed validation into a bounded debug loop next approach;
  - opt-in real Pi/model bounded debug conductor chain from validation failure through debug `needs_research` → research completion → debug `next_approach` with persisted ledgers and audit events.
- `real/real-pi-flow-parity.test.ts`
  - real non-debug child free-form output rejection for stage, replan, and research agents without ledger mutation;
  - real debug-agent `needs_research` report → research request ledger;
  - real research-agent complete report → request resolution;
  - real debug-agent `next_approach` report → debug report ledger;
  - real `/scaler-memory-search` and `/scaler-context-splits` summary output plus real research raw evidence → memory entry → later task context manifest reference;
  - real debug-agent `needs_replan` report → debug-blocked replan request → safe replan acceptance → retry-gate clearance;
  - real Stage I-IV conductor loop using cardinal stage artifacts, readiness/semantic/consistency advancement, and final completed state;
  - real unsafe replanner proposal → failed preservation check → rejected acceptance with current plan unchanged;
  - real `/scaler-planning-reports` inspection and real replanner proposal ingestion → preservation check → proposal acceptance → current-plan replacement, version snapshot, replan decision, request resolution, and task creation.
- `real/real-pi-harness.ts`
  - shared temp-repository and `pi --mode json -p --no-session -e <src/index.ts>` harness for opt-in real extension tests.
