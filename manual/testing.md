# Testing

SCALER uses Node's built-in test runner through:

```bash
npm test
npm run build
```

## Test layers

Current tests include:

- component/unit tests for individual modules;
- persistence-oriented tests that use temporary `.scaler/` directories;
- integration tests in `test/integration/*.test.ts` that create temporary git repositories, run multi-module SCALER workflows, and assert persisted artifacts.

Integration scenarios should be derived from `assignement.md` and relevant `specs/*.md` as well as the PRD catalog/matrix. The goal is to catch system-level orchestration errors that local unit tests can miss. See `test/integration/README.md` for the detailed suite contract and extension guide.

## Mock integration mode

Default integration tests use deterministic mock child-agent runners. They do not call a real Pi model and are safe for normal CI/local runs.

The current integration harness covers:

- conductor task execution into validation handoff;
- failing validation into debugging;
- debug attempt cycle detection and retry gate refusal;
- focused debug-agent report ingestion;
- debug report creation of research requests;
- focused research-agent report ingestion and request resolution;
- next-approach debug reports and retry-gate clearance by later `newEvidence`;
- rejection of child free-form text without a structured `scaler_debug_report` event.

## Optional real Pi/model mode

One integration test can run against real Pi/model execution when explicitly enabled:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=<model-name> \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm test
```

Environment variables:

- `SCALER_REAL_PI_INTEGRATION=1` enables the optional real test. It is skipped otherwise.
- `SCALER_REAL_PI_MODEL` optionally selects a model.
- `SCALER_REAL_PI_COMMAND` optionally selects the Pi executable path/name; default is `pi`.
- `SCALER_REAL_PI_TIMEOUT_MS` optionally controls timeout; default is `60000`.

Real-mode prompts include a cardinal test instruction before the normal debug-agent prompt. The instruction tells the model to ignore conflicting context and emit exactly the structured JSON event required by the test, with no prose or markdown. This keeps the test as close as possible to a real subprocess/model run while remaining deterministic when the configured model obeys the instruction.

Real Pi/model tests are intentionally opt-in because they can cost tokens, require local model/provider setup, and may be less deterministic than mock integration tests.
