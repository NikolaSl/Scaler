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
- `.scaler/research/requests.json`
- `.scaler/research/reports.json`
- `.scaler/plans/replan-requests.json`
- `.scaler/reports/validation-runs.json`
- `.scaler/reports/*-agent-runs.json`
- `.scaler/logs/events.jsonl`
- `.scaler/stages/stage-artifacts.json`
- `.scaler/plans/current-plan.json`
- `.scaler/plans/proposed-plan.json`
- `.scaler/plans/replan-decisions.json`

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
2. real Pi extension integrity tests that launch `pi --mode json -p --no-session -e <src/index.ts>` in a temporary repository and verify extension command dispatch, SCALER tool calls, safety hooks, `.scaler/logs/events.jsonl`, detail payload references, and persisted state; and
3. real flow-parity chains that run real Pi/model child agents through SCALER's normal debug, research, stage, and replanner pathways while asserting persisted ledgers.

Command-dispatch extension tests may avoid model output. Cardinal SCALER-tool and hook tests use the selected real model with restricted `--tools` lists. Report-only child-agent flow tests disable tools with `--no-tools` so the real model cannot mutate the temporary repository outside the expected structured report.

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
  - conductor execution into validation handoff;
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
- `mock/stage-replan-plan-flow.test.ts`
  - stage conductor loop from PRD through knowledge, planning, execution, and completion;
  - stage-agent structured artifact ingestion, readiness, semantic, consistency, advancement, run records, and audit logs;
  - runtime PRD requirements plus coverage-gap replan request;
  - replanner-agent structured proposal ingestion, preservation checks, proposed-plan persistence, run records, and audit logs;
  - replan proposal acceptance, current-plan replacement, version snapshot, replan decision, request resolution, and task creation;
  - validated-task git commit through the execution lock while preserving `.scaler/` runtime artifacts and recording git audit logs.
- `mock/remaining-flows.test.ts`
  - budget hard stops for conductor and validation plus pause/audit behavior;
  - context discovery into conductor prompts, including exactness/compression guidance;
  - structured-only rejection for stage, replan, and research agents;
  - unsafe replan proposal acceptance rejection;
  - debug report to replan request to acceptance retry-gate clearance;
  - blocked validation to replan proposal acceptance;
  - execution-lock contention across conductor, validation, stage, replan, research, debug, and commit workflows;
  - safety/allowed-path and commit-refusal chains;
  - research raw evidence memory references in later context;
  - stage consistency rejection;
  - dependency-blocked task selection and release after dependency validation.

## Current real scenarios

- `real/real-pi-contracts.test.ts`
  - opt-in cardinal structured-output contract for `scaler_debug_report`;
  - opt-in cardinal structured-output contract for `scaler_research_report`;
  - opt-in cardinal structured-output contract for `scaler_stage_artifact`;
  - opt-in cardinal structured-output contract for `scaler_replan_proposal`;
  - real Pi `--mode json` wrapper extraction for exact assistant JSON events.
- `real/real-pi-extension-integrity.test.ts`
  - real Pi extension load and slash-command dispatch via `/scaler-lock`;
  - command audit events and detail payload references in `.scaler/logs/events.jsonl`;
  - cardinal real-model call to `scaler_task_create` with exact arguments and persisted SCALER task state;
  - cardinal real-model call to built-in `bash` with `cat .env`, blocked by SCALER's safety hook and recorded as a safety audit event.
- `real/real-pi-debug-conductor.test.ts`
  - opt-in real Pi/model validation-debug workflow from actual failed validation into a bounded debug loop next approach;
  - opt-in real Pi/model bounded debug conductor chain from validation failure through debug `needs_research` → research completion → debug `next_approach` with persisted ledgers and audit events.
- `real/real-pi-flow-parity.test.ts`
  - real non-debug child free-form output rejection for stage, replan, and research agents without ledger mutation;
  - real debug-agent `needs_research` report → research request ledger;
  - real research-agent complete report → request resolution;
  - real debug-agent `next_approach` report → debug report ledger;
  - real research raw evidence → memory entry → later task context manifest reference;
  - real debug-agent `needs_replan` report → debug-blocked replan request → safe replan acceptance → retry-gate clearance;
  - real Stage I-IV conductor loop using cardinal stage artifacts, readiness/semantic/consistency advancement, and final completed state;
  - real unsafe replanner proposal → failed preservation check → rejected acceptance with current plan unchanged;
  - real replanner proposal ingestion → preservation check → proposal acceptance → current-plan replacement, version snapshot, replan decision, request resolution, and task creation.
- `real/real-pi-harness.ts`
  - shared temp-repository and `pi --mode json -p --no-session -e <src/index.ts>` harness for opt-in real extension tests.
