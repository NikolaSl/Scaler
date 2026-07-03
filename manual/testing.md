# Testing

SCALER uses Node's built-in test runner plus TypeScript build checks.

## Standard validation

```bash
npm test
npm run build
```

`npm test` runs unit/component tests and the deterministic mocked integration suite. It must remain safe for normal local/CI runs and must not invoke real Pi/model subprocesses.

## Test layers

Current tests include:

- component/unit tests in `test/*.test.ts`;
- persistence-oriented tests that use temporary `.scaler/` directories;
- deterministic mocked integration tests in `test/integration/mock/*.test.ts`;
- optional real Pi/model contract tests in `test/integration/real/*.test.ts`.

Integration scenarios should be derived from `assignement.md` and relevant `specs/*.md` as well as the PRD catalog/matrix. The goal is to catch system-level orchestration errors that local unit tests can miss. See `test/integration/README.md` for the detailed suite contract and extension guide.

## Scripts

```bash
npm run test:unit                # unit tests only
npm run test:integration         # mocked integration by default
npm run test:integration:mock    # mocked integration only
npm run test:integration:real    # real suite only; skipped unless enabled
```

## Mock integration mode

Default integration tests use deterministic mock child-agent runners. They do not call a real Pi model and are safe for normal CI/local runs.

The current mocked integration harness covers:

- conductor task execution into validation handoff;
- failing validation into debugging;
- debug attempt cycle detection and retry-gate refusal;
- focused debug-agent report ingestion;
- debug report creation of research requests;
- focused research-agent report ingestion and request resolution;
- next-approach debug reports and retry-gate clearance by later `newEvidence`;
- rejection of child free-form text for debug, stage, replan, and research agents;
- stage conductor artifact ingestion and advancement from PRD through knowledge, planning, execution, and completion;
- runtime PRD coverage-gap replanning through proposal ingestion, preservation checks, proposal acceptance, current-plan replacement, decisions, snapshots, request resolution, and task creation;
- budget hard-stop refusal for conductor/validation paths with pause and audit behavior;
- deterministic context discovery feeding conductor prompts with exactness/compression guidance;
- unsafe replan proposal acceptance rejection;
- debug report → replan request → replanner proposal → acceptance retry-gate clearance;
- blocked validation → replan request → proposal acceptance;
- execution-lock contention across conductor, validation, stage-agent, replan-agent, research-agent, debug-agent, and commit workflows;
- safety/allowed-path enforcement and commit-refusal chains;
- research raw evidence externalization to memory and later context references;
- stage consistency rejection;
- dependency-blocked task selection and release after dependency validation;
- validated-task git commits through execution locks while `.scaler/` runtime artifacts remain uncommitted and git audit logs are recorded.

## Optional real Pi/model mode

The real integration suite can run against real Pi/model execution when explicitly enabled:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=<model-name> \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm run test:integration:real
```

Environment variables:

- `SCALER_REAL_PI_INTEGRATION=1` enables real contract tests. They are skipped otherwise.
- `SCALER_REAL_PI_MODEL` optionally selects a model.
- `SCALER_REAL_PI_COMMAND` optionally selects the Pi executable path/name; default is `pi`.
- `SCALER_REAL_PI_TIMEOUT_MS` optionally controls timeout; default is `60000`.

Real-mode prompts include a cardinal test instruction before the normal agent prompt. The instruction tells the model to ignore conflicting context and emit exactly one structured JSON event, with no prose or markdown. Current real contracts cover debug, research, stage, and replan agent structured event ingestion.

Real Pi/model tests are intentionally opt-in because they can cost tokens, require local model/provider setup, and may be less deterministic than mock integration tests.
