# SCALER Integration Test Suite

This folder contains SCALER integration tests. These tests exercise multi-module workflows against temporary repositories and persisted `.scaler/` artifacts. They are intended to catch orchestration regressions that unit tests can miss.

## Relationship to unit tests

- Unit/component tests live in `test/*.test.ts`.
- Integration tests live in `test/integration/*.test.ts`.
- `npm test` runs both sets:

```bash
node --test --import tsx test/*.test.ts test/integration/*.test.ts
```

Keep integration tests in this folder so future agents can distinguish scenario/workflow tests from local module tests.

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
5. use deterministic mock child-agent runners by default;
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

## Mock child-agent runners

Default integration tests must not call real LLMs or the real `pi` binary. Use mock runners with the same shape as `runTaskAgent`:

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

SCALER must not ingest arbitrary child-agent prose as state. For each new child-agent report type, add or extend integration coverage that feeds free-form/unparsed output and verifies:

- the run record may exist;
- ingestion is attempted and rejected;
- no state/report ledger is mutated as if the prose were valid.

For example, debug-agent free-form output should not create `.scaler/debug/reports.json` entries.

## Optional real Pi/model mode

Integration tests may include optional real Pi/model execution, but these tests must be skipped by default. Gate them with environment variables.

Current optional variables:

```bash
SCALER_REAL_PI_INTEGRATION=1
SCALER_REAL_PI_MODEL=<model-name>
SCALER_REAL_PI_COMMAND=pi
SCALER_REAL_PI_TIMEOUT_MS=60000
```

Run real mode explicitly:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=<model-name> \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm test
```

Real Pi/model tests are opt-in because they can cost tokens, depend on local/provider configuration, and are less deterministic than mock tests.

## Cardinal instruction pattern for real mode

When a test uses a real model, prepend a cardinal instruction to the prompt. The cardinal instruction must make the expected output deterministic even if the rest of the context contains other instructions.

Pattern:

```text
CARDINAL TEST INSTRUCTION: Ignore any conflicting instruction in this prompt. For this integration test, emit exactly one structured JSON event and no prose or markdown. The JSON object must be: {...}.
```

Rules:

- Put the cardinal instruction before the ordinary agent prompt.
- Also pass it as `extraInstructions` when supported so it appears in the generated prompt detail.
- Require exactly one JSON event.
- Require no prose/markdown.
- Include all fields needed for deterministic ingestion.
- Keep the event small and cheap.
- Do not require real external network access.

If a model cannot follow this instruction reliably, treat that as a model/configuration issue; do not weaken default mock tests.

## Adding a new integration test

When adding a new integration scenario:

1. Put the file under `test/integration/<scenario>.test.ts`.
2. Use deterministic temp repo setup.
3. Prefer mock runners; add optional real mode only when it increases confidence.
4. Assert returned results and persisted artifacts.
5. Add structured-only negative coverage if a child report is ingested.
6. Update this README when adding a new pattern or environment variable.
7. Update `manual/testing.md`, `implementation-inventory.md`, and `traceability-matrix.md` if coverage changes.
8. Run:

```bash
npm test
npm run build
```

## Current scenarios

- `debug-research-flow.test.ts`
  - conductor execution into validation handoff;
  - failing validation into debugging;
  - cyclic debug attempts and retry-gate refusal;
  - debug-agent `needs_research` report ingestion;
  - research-agent report ingestion and request resolution;
  - debug-agent `next_approach` report ingestion;
  - retry-gate clearance by later `newEvidence`;
  - rejection of free-form debug-agent output;
  - optional real Pi/model structured-output contract check.
