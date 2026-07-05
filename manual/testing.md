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

- conductor task execution into structured task-agent report ingestion before validation handoff, including missing/invalid report blocking and structured missing-context request creation/resolution/retry;
- task-definition quality reviews and enforced user-facing/planner task creation for missing Definition of Done, validation refs/commands, allowed path scope, atomicity rationale, test-first coverage, and explicit waiver records;
- failing validation into debugging;
- debug attempt cycle detection and retry-gate refusal;
- focused debug-agent report ingestion;
- debug report creation of research requests;
- focused research-agent report ingestion and request resolution;
- explicit internet research grant behavior, with tools withheld until `internet tools=...` is supplied, web research transaction planning/execution through discovered browser/search/MCP schema records, and source metadata/freshness persisted from structured reports;
- next-approach debug reports and retry-gate clearance by later `newEvidence`;
- rejection of child free-form text for debug, stage, replan, and research agents;
- stage conductor artifact ingestion and advancement from PRD through knowledge, planning, execution, and completion;
- autonomous stage workflow coordination for PRD ledger ingestion, Stage II research request fanout/merge into `.scaler/knowledge/knowledge-report.md`, planner report synchronization, and execution-discovered coverage-gap replanning;
- runtime PRD coverage-gap replanning through proposal ingestion, preservation checks, proposal acceptance, current-plan replacement, decisions, snapshots, request resolution, task creation, and planner-report PRD/plan/task coverage synchronization;
- budget hard-stop refusal for conductor/validation paths with pause and audit behavior;
- command-driven budget configuration feeding later validation hard-stop behavior;
- provider usage metadata from Pi turn events updating token/cost budget counters and audit logs;
- watchdog heartbeats, no-progress/replanning triggers, pause checkpoints, resume verification, scoped complexity budget policies, and subprocess cleanup records;
- storage status inventory indexing plus budget hard-pause behavior;
- storage maintenance command execution with safe gzip compression, explicit cache cleanup, approved archive/raw-log/memory retention deletion, scheduled maintenance due checks, persisted reports/schedule config, storage budget usage, and audit logs;
- typed validation gate metadata plus dependency/test-first and CI/sandbox environment policy diagnostics, deterministic CI/CD wrapper provisioning, validation environment lifecycle evidence, and `/scaler-validation-envs`/`/scaler-cicd-envs` status persisted through `/scaler-validation-add`, validation runs, lifecycle/provision records, and audit logs;
- deterministic non-software validation checklists persisted through `/scaler-validation-checklist`, task status transitions, evidence-required acceptance/completeness/source policies, and audit logs;
- rich `scaler_tool_request` metadata, `scaler_tool_schema` discovery ledgers, supervised schema discovery probe ledgers, project-local MCP server enumeration ledgers, compact selected-tool catalog prompts with discovered schema injection, compact parent-session runtime tool catalog injection, active-tool focus/restore, child-agent deny-by-default `--no-tools` invocation, automatic SCALER extension loading when child tools are granted, isolated allowed-tool invocation prep, tool transaction prepare/execute/replay ledgers, closed replay approval ledgers, bounded tool-iteration correction ledgers/policy, safe low-risk tool scheduling ledgers, `missing_result`/`missing_schema` handling for free-form child output, and structured `scaler_tool_result` request closure;
- deterministic context discovery feeding conductor prompts with exactness/compression guidance, semantic-style candidate curation/approval, parent-session `context` hook injection filtering, automatic context-split artifacts for oversized resolved context, externalized exact/summary-ok memory refs, and fresh minimal-context handoff shrink checks;
- unsafe replan proposal acceptance rejection;
- debug report → replan request → replanner proposal → acceptance retry-gate clearance;
- bounded debug conductor chains from validation failure through debug → research → debug next approach;
- validation-debug workflow runs actual validation failure, then starts the bounded debug loop after the validation lock is released;
- explicit and policy-driven debug next-approach retry execution, exact failed-validation rerun, retry approval ledgers, retry/debug-attempt ledgers, and optional full validation after exact pass;
- bounded debug conductor stages replanner proposals from debug `needs_replan` without accepting them;
- blocked validation → replan request → proposal acceptance;
- execution-lock contention across conductor, validation, stage-agent, replan-agent, research-agent, debug-agent, and commit workflows;
- safety/allowed-path enforcement, external/secret safety-hook blocking, persisted safety-policy allowances, scoped approval consumption, bounded sandbox exceptions, optional scanner records, redacted audit serialization, large tool-result reference storage, and commit-refusal chains;
- research raw evidence externalization to memory, memory search/tag filtering, summary-scoped context references, and later context references;
- stage consistency rejection;
- dependency-blocked task selection and release after dependency validation;
- validated/validation-passed git commits through execution locks, git bootstrap ignore-rule records, pre-task dirty-tree checkpoints, commit-required validation acceptance ordering, explicit commit-skip promotion, `.scaler/` runtime artifacts remaining uncommitted, and git audit logs plus `.scaler/reports/commits.json`/`commit-skips.json`/`git-bootstrap.json` reports.

## Optional real Pi/model mode

The real integration suite can run against real Pi/model execution when explicitly enabled:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=openai-codex/gpt-5.3-codex-spark \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=60000 \
npm run test:integration:real
```

Environment variables:

- `SCALER_REAL_PI_INTEGRATION=1` enables real contract tests. They are skipped otherwise.
- `SCALER_REAL_PI_MODEL` optionally selects a model. Prefer provider-qualified values such as `openai-codex/gpt-5.3-codex-spark` when `/model` displays a provider, because unqualified names can resolve differently in subprocesses.
- `SCALER_REAL_PI_COMMAND` optionally selects the Pi executable path/name; default is `pi`.
- `SCALER_REAL_PI_TIMEOUT_MS` optionally controls timeout; default is `60000`.

Real-mode prompts include a cardinal test instruction before the normal agent prompt. Structured-output contracts require exactly one structured JSON event, with no prose or markdown. Tool/hook integrity contracts require exactly one named tool call with exact arguments and use restricted `--tools` lists. Current real coverage includes:

- debug, research, stage, and replan agent structured event ingestion through real Pi/model subprocesses;
- explicit research internet-tool grant contract coverage where the cardinal subprocess receives only the listed tool grant and persists source URL metadata, plus slash-command web research transaction planning;
- exact assistant JSON objects carried inside Pi `--mode json` event wrappers, while prose/markdown text is still rejected;
- real free-form rejection for stage, replan, and research child-agent outputs without mutating ledgers;
- real chained debug → research → next-approach flow-parity through persisted debug/research ledgers;
- real bounded debug conductor chain from validation failure through debug → research → debug next approach;
- real validation-debug workflow from actual failing validation into a bounded debug loop next approach;
- real memory search/context candidate/context-split command summary output, real context candidate approval, real fresh-context handoff and compaction-record command dispatch, real missing-context list/resolve command dispatch, real autonomous stage-workflow prepare command dispatch, and real research raw-evidence externalization into memory/later task context manifests;
- real debug-blocked replan request creation plus safe replan acceptance that clears the retry gate;
- real chained Stage I-IV conductor flow-parity through persisted stage artifacts and stage-agent run records;
- real unsafe replan proposal rejection without replacing the current plan;
- real planner-report listing plus real chained replanner proposal → acceptance flow-parity through proposed/current plan artifacts, snapshots, decisions, and task creation;
- report-only child agents launched with `--no-tools` for cardinal JSON-output tests, plus real subprocess assertions that granted-tool children include the SCALER extension and report-only stage children remain toolless;
- real Pi extension loading via `-e src/index.ts`;
- slash-command dispatch and command audit logs;
- slash-command budget configuration/status persistence, complexity budget-policy approval, watchdog heartbeat/status/cleanup/resume-check persistence, provider usage turn accounting, and audit logs;
- slash-command storage status inventory persistence and audit logs;
- slash-command storage maintenance execution, scheduled maintenance due checks, active-ledger rotation, approved archive/raw-log/memory retention deletion, persisted maintenance/schedule reports, and audit logs;
- slash-command debug next-approach retry prepare mode plus retry-policy persistence with persisted retry records and prompt audit logs;
- slash-command active-tool catalog, MCP enumeration, tool transaction, tool transaction replay, tool replay approval, tool scheduling plan, tool iteration policy/prepare mode, and schema discovery prepare modes with persisted MCP/transaction/probe/schedule/iteration/approval records;
- slash-command typed validation gate metadata, gate/environment/disposition policy enforcement, validation environment lifecycle records/status, deterministic CI/CD sandbox provisioning/status, skipped/blocked disposition persistence, non-software checklist persistence, evidence-policy enforcement, and audit logs;
- slash-command strict task creation with quality review persistence and cardinal SCALER tool invocation with persisted `.scaler/state.json` mutation;
- cardinal `scaler_tool_schema` invocation with persisted discovered metadata;
- cardinal `scaler_tool_request` invocation with persisted rich metadata;
- cardinal `scaler_tool_result` invocation with persisted result ledger and closed request status;
- slash-command git bootstrap, commit-skip acceptance after passed validation, safety-policy and safety-approval persistence, cardinal built-in `bash` invocation blocked by the SCALER safety hook for protected-path and external publish commands, and large `bash` tool-result externalization into `.scaler/logs/tools/`, recorded in `.scaler/logs/events.jsonl` with redacted audit details.

Real Pi/model tests are intentionally opt-in because they can cost tokens, require local model/provider setup, and may be less deterministic than mock integration tests.
