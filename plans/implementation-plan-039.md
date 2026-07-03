# Implementation Plan 039 — Mocked and Real Integration Suite Expansion

## Goal
Expand SCALER chain-integration coverage for all currently implemented cross-component flows that can be tested, and separate deterministic mocked integration tests from optional real-Pi/model integration tests.

## Suite structure

- Mocked integration suite: `test/integration/mock/*.test.ts`
  - Runs by default through `npm test`.
  - Uses deterministic mock child-agent runners only.
  - Must not call the real `pi` executable or external models.
- Real integration suite: `test/integration/real/*.test.ts`
  - Runs only through an explicit script and environment gate.
  - Uses real `pi` subprocess/model calls where a child-agent output contract is being tested.
  - Uses cardinal instructions requiring exact structured JSON output and no prose.
  - Must remain separate from default CI/local deterministic tests.

## Atomic tasks

### PLAN-039 — Plan
- Create this plan and commit it. This is a PLAN task, not an IMPL task.

### IMPL-148 — Split integration suites and npm scripts
- Move existing deterministic integration tests under `test/integration/mock/`.
- Move the existing optional real-Pi contract test under `test/integration/real/`.
- Update imports after moving files.
- Update package scripts:
  - `test` = unit + mocked integration.
  - `test:unit` = unit tests only.
  - `test:integration:mock` = mocked integration only.
  - `test:integration:real` = real integration only, env-gated.
  - `test:integration` = mocked integration by default.
- Preserve deterministic default validation.
- Run `npm test` and `npm run build`.

### IMPL-149 — Add remaining mocked chain-integration flows
Add mocked temp-repo integration coverage for implemented behavior:

1. Budget hard-stop chains:
   - conductor hard-limit refusal before task-agent execution;
   - validation hard-limit refusal before commands;
   - state pause and budget audit events.
2. Context discovery → conductor prompt chain:
   - missing task manifest triggers deterministic discovery;
   - context includes changed files, PRD refs, execution plan refs, validation/memory refs where available;
   - conductor prompt includes exactness/compression guidance.
3. Structured-only negative cases:
   - stage-agent free-form output rejected;
   - replan-agent free-form output rejected;
   - research-agent free-form output rejected;
   - run records exist but ledgers are not mutated as reports.
4. Unsafe replan proposal rejection:
   - a proposed plan drops validated work/coverage;
   - proposed plan may be saved, but acceptance rejects;
   - decision ledger records rejection;
   - current plan and tasks remain unchanged.
5. Debug report → replan request → acceptance clearance:
   - debug-agent emits `needs_replan` or `blocked`;
   - replan request is created;
   - replanner proposes preserving replacement plan;
   - acceptance resolves request and clears retry gate where applicable.
6. Validation blocked → replan acceptance:
   - blocked validation creates a replan request;
   - state enters replanning when allowed;
   - replanner proposes plan;
   - acceptance resolves request.
7. Execution-lock contention:
   - held lock prevents conductor, validation, stage-agent, replan-agent, research-agent, debug-agent, and commit workflows.
8. Safety / allowed-path chain:
   - tool safety rejects out-of-scope or protected operations;
   - git commit refuses unrelated changes;
   - commit succeeds after unrelated changes are removed.
9. Memory + research raw evidence chain:
   - research raw evidence externalizes to memory;
   - later context discovery or prompt references memory refs.
10. Stage consistency rejection chain:
   - artifact references unknown PRD/task/replan refs;
   - conductor refuses advancement;
   - state remains unchanged.
11. Task dependency chain:
   - conductor skips dependency-blocked task;
   - after dependency validation, conductor selects dependent task.
12. Commit refusal chain:
   - non-validated task refuses commit;
   - unrelated dirty tree refuses commit;
   - allowed validated change commits.

Run `npm test` and `npm run build`.

### IMPL-150 — Add real-Pi integration suite contracts
- Add real-Pi tests under `test/integration/real/` for child-agent report contracts using cardinal instructions:
  - debug-agent emits `scaler_debug_report`;
  - research-agent emits `scaler_research_report`;
  - stage-agent emits `scaler_stage_artifact`;
  - replan-agent emits `scaler_replan_proposal`.
- Keep each real test small and deterministic.
- Skip/refuse unless `SCALER_REAL_PI_INTEGRATION=1` is set.
- Use `SCALER_REAL_PI_MODEL`, `SCALER_REAL_PI_COMMAND`, and `SCALER_REAL_PI_TIMEOUT_MS`.
- Do not require external network access.
- Run `npm run test:integration:mock`, `npm run build`; real suite is not part of default validation unless env is explicitly set.

### IMPL-151 — Documentation and traceability
- Update `test/integration/README.md` with separate mock/real suites, scripts, and current scenarios.
- Update `manual/testing.md`.
- Update `implementation-inventory.md`, `traceability-matrix.md`, and `gap-backlog.md` for coverage changes.
- Run `npm test` and `npm run build`.

## Validation

Default deterministic validation:

```bash
npm test
npm run build
```

Mock integration only:

```bash
npm run test:integration:mock
```

Real integration only, explicitly enabled:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=<model-name> \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm run test:integration:real
```
