# Implementation Plan 041 — Real Pi Cardinal Extension Integrity Suite

## Goal
Add an opt-in real-Pi integration layer that validates SCALER inside a real Pi process, not only through injected mock runners or child-agent contract tests. The suite must use cardinal instructions to make the model output deterministic while still exercising real Pi extension loading, command dispatch, tool calls, hooks, JSON-mode event streams, SCALER audit logs, and persisted `.scaler/` ledgers.

## Motivation
The project is large enough that relying only on unit tests, injected mock integration tests, and narrow real child-agent contracts can hide integration failures at the Pi host boundary. We need proof that the direction is viable before investing heavily:

- SCALER extension loads in a real Pi process.
- SCALER slash commands execute through Pi command dispatch.
- SCALER tools can be selected and called by a real model under a cardinal instruction.
- SCALER safety hooks observe and block real Pi tool calls.
- SCALER audit logs and detailed ledgers record the expected execution path.
- Tests remain opt-in and cardinal-controlled to manage cost and nondeterminism.

## Suite model

- Location: `test/integration/real/`.
- Gate: `SCALER_REAL_PI_INTEGRATION=1`.
- Model: provider-qualified `SCALER_REAL_PI_MODEL`, defaulted by runner to `openai-codex/gpt-5.3-codex-spark`.
- Command: `SCALER_REAL_PI_COMMAND`, default `pi`.
- Timeout: `SCALER_REAL_PI_TIMEOUT_MS`, default `60000`.
- SCALER extension path: absolute `src/index.ts` loaded via `-e`.
- Validation source: persisted `.scaler/` state, ledgers, and `.scaler/logs/events.jsonl`, not final prose.

## Cardinal instruction rule

Real-model tests must include an explicit cardinal instruction that tells the model to ignore conflicting context and perform exactly one deterministic action. Accepted actions:

1. Emit exactly one structured JSON object for agent report contracts.
2. Call exactly one named SCALER tool with exact arguments.
3. Call exactly one built-in tool with exact arguments to test SCALER hooks.

The tests must still reject or fail if the model does not perform the requested action, because that indicates the real model/host boundary is not reliable enough for that scenario.

## Atomic tasks

### PLAN-041 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-154 — Add real Pi extension harness
- Add shared real-Pi test helpers for temporary repositories, invoking `pi --mode json -p --no-session -e <scaler-extension>`, parsing JSONL stdout/stderr, and reading SCALER audit logs.
- Support command-only real Pi tests that do not require model output.
- Support cardinal real-model prompts with restricted tool lists.
- Keep helpers local to `test/integration/real/` unless they become broadly useful.
- Add a command-dispatch scenario proving `/scaler-lock` or another low-cost SCALER command executes inside real Pi and writes command audit events.
- Run targeted real test(s), `npm test`, and `npm run build`.

### IMPL-155 — Add cardinal real Pi tool and hook scenarios
- Add a real-model cardinal tool-call scenario:
  - load SCALER extension in real Pi;
  - restrict tools to one SCALER tool such as `scaler_task_create` or `scaler_research_report`;
  - instruct the model to call that tool with exact arguments;
  - assert the expected `.scaler/` ledger/state mutation and audit log events.
- Add a real-model cardinal hook scenario:
  - load SCALER extension in real Pi;
  - restrict tools to a built-in tool such as `bash`;
  - instruct the model to call a protected/destructive command;
  - assert SCALER safety hook blocks it and records safety/tool audit events.
- Keep each scenario minimal and cheap.
- Run the real suite, `npm test`, and `npm run build`.

### IMPL-156 — Document real Pi integrity validation
- Update `test/integration/README.md` and `manual/testing.md` to describe the real Pi extension integrity suite and cardinal tool/hook pattern.
- Update `dev-progress-tracker/implementation-inventory.md`, `dev-progress-tracker/traceability-matrix.md`, and `dev-progress-tracker/gap-backlog.md` if coverage changes.
- Ensure the runner script remains the easiest way to execute all opt-in real Pi tests.
- Run the real suite, `npm test`, and `npm run build`.

## Validation commands

Default deterministic validation:

```bash
npm test
npm run build
```

Real Pi validation:

```bash
./scripts/run-real-integration.sh
```

Equivalent explicit command:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=openai-codex/gpt-5.3-codex-spark \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm run test:integration:real
```

## Non-goals

- Do not move these tests into default CI.
- Do not rely on arbitrary free-form model prose for state validation.
- Do not hide model noncompliance by weakening assertions.
- Do not replace deterministic mock integration tests; this is an additional real-boundary layer.
