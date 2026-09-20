# Testing

SCALER uses Node's built-in test runner plus TypeScript build checks.

## Standard validation

```bash
npm test
npm run build
```

`npm test` runs unit/component tests and the deterministic mocked integration suite. It must remain safe for normal local/CI runs and must not invoke real Pi/model subprocesses. `npm run test:conformance` runs the top-level product conformance checks that guard against requirement/manual/code drift and `/scaler` automation regressions.

## Test layers

Current tests include:

- component/unit tests in `test/*.test.ts`;
- persistence-oriented tests that use temporary `.scaler/` directories;
- deterministic mocked integration tests in `test/integration/mock/*.test.ts`;
- product conformance tests in `test/conformance.test.ts` and `/scaler` automation acceptance coverage in `test/autopilot.test.ts`;
- optional real Pi/model contract tests in `test/integration/real/*.test.ts`.

Integration scenarios should be derived from `assignement.md` and relevant `specs/*.md` as well as the PRD catalog/matrix. The goal is to catch system-level orchestration errors that local unit tests can miss. See `test/integration/README.md` for the detailed suite contract and extension guide.

## Scripts

```bash
npm run test:unit                # unit tests only
npm run test:conformance         # top-level product conformance and /scaler automation acceptance
npm run test:integration         # mocked integration by default
npm run test:integration:mock    # mocked integration only
npm run test:integration:real    # real suite only; skipped unless enabled
```

## Free model smoke test

Tested with Pi 0.85.1: OpenCode Zen's `big-pickle` model supports public free
access. The [official provider implementation](https://github.com/anomalyco/opencode/blob/88c6c7abc7f320b6aabed2634ac0b2d6e6ecea67/packages/core/src/plugin/provider/opencode.ts)
uses the literal `public` key for unauthenticated free models. This is not a
personal credential. Check [current availability and pricing](https://opencode.ai/docs/zen/)
before reuse; the free offer is temporary and requests may be rate-limited.
Use synthetic fixtures: the provider says free-model data may be used for training.

Merge the `opencode-free-test` provider from
[`pi-free-models.example.json`](../test/integration/real/pi-free-models.example.json)
into the `providers` object in `~/.pi/agent/models.json`, preserving existing
entries. Its 8192-token context and 1024-token output settings are conservative
test limits, not advertised model maxima. The profile selects one free model
and does not configure a paid fallback. Zero cost metadata is for Pi's accounting;
the provider's pricing determines actual charges.

```bash
pi --offline --no-extensions --no-skills --no-context-files \
  --no-prompt-templates --no-tools --no-session \
  --model opencode-free-test/big-pickle --thinking off \
  -p 'Reply with exactly OK.'

SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=opencode-free-test/big-pickle \
SCALER_REAL_PI_COMMAND=pi \
SCALER_REAL_PI_TIMEOUT_MS=45000 \
node --test --import tsx \
  --test-name-pattern='^real integration: task agent report gates validation handoff$' \
  test/integration/real/real-pi-contracts.test.ts
```

`--offline` disables catalog refresh, not inference. The contract test checks
structured report ingestion and durable handoff to validation. It does not
establish coding ability, completed QA, or overall requirements conformance.

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

For a single bounded Spark contract check, first authenticate in Pi with `/login`
and select the Codex subscription provider. On a headless machine choose device
code login. Both the authorization service and model endpoint must be reachable;
a browser confirmation alone does not establish that Pi received credentials.
Keep credentials in Pi's private runtime storage, outside the repository.

Run from this checkout after authentication:

```bash
SCALER_REAL_PI_INTEGRATION=1 \
SCALER_REAL_PI_MODEL=openai-codex/gpt-5.3-codex-spark \
SCALER_REAL_PI_COMMAND="$PWD/node_modules/.bin/pi" \
SCALER_REAL_PI_TIMEOUT_MS=30000 \
node --test --import tsx \
  --test-name-pattern='^real integration: task agent report gates validation handoff$' \
  test/integration/real/real-pi-contracts.test.ts
```

This requests one model-backed report/handoff contract scenario with tools disabled.
Its fixture report does not establish real task correctness or full SC-10
acceptance. A missing account/model entitlement or blocked network is a blocked
check, not a pass; do not silently substitute another model.

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
- real Pi extension loading via `-e extensions/scaler/index.ts`;
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

### Attempt identity and stale evidence (PLAN-101)

Conductor and debug-retry synthetic runners must echo the request's `attempt`
fields in their final `scaler_task_report`. Actual Pi subprocesses receive these
values in the prompt's report template; an unbound report is not valid for an
admitted attempt. Preview mode creates no attempt.

Run `node --test --import tsx test/attempt-execution.test.ts test/attempt-evidence.test.ts test/task-attempts.test.ts test/task-reports.test.ts test/conductor.test.ts test/debug-retry.test.ts test/fingerprints.test.ts`.
The suite covers budget refusal before launch, distinct retry IDs, exact binding,
replacement/changed task-policy rejection, recovery publication failure,
unknown post-dispatch outcomes, and changed context/report evidence both before
validation and during a passing validation command.

Interrupted execution locks require explicit operator reconciliation; there is
no age-based takeover or automatic replay. Do not manually delete attempt records.
Legacy records are readable history, not upgraded identity evidence. These tests
do not certify all command/tool/hook acceptance routes (P2.3), artifact correctness,
exactly-once effects or complete requirements conformance.

### Version-bound commit acceptance (PLAN-102)

Run `node --test --import tsx test/validation-acceptance.test.ts test/git.test.ts test/operations.test.ts`.
Commit and explicit commit-skip now require a current supervisor command-validation
receipt. A task's `validated` label or historical `passed` record is insufficient.
After changing the task, policy, attempt, declared context or Git candidate, rerun
validation. Do not patch old ledgers to manufacture receipt fields.

Checks must not change the candidate they certify: generate candidate output before
validation, or rerun validation after generation. Put runtime-only test logs/markers
under `.scaler` or an appropriately ignored artifact directory. The Git candidate
snapshot covers HEAD plus changed and non-ignored untracked bytes, deletions,
executable modes and symlink targets. It is not a semantic correctness check, a
non-Git output snapshot, a multi-file transaction or authenticated worker isolation.
Manual report/checklist and other acceptance routes remain P2.3 follow-up work.
Rename detection is disabled for candidate enumeration so source deletion is not
lost. Changed paths beneath symlink ancestors fail closed rather than reading
through the link; reconcile the project structure before retrying validation.

### Generic proposal acceptance guards (PLAN-103)

Run `node --test --import tsx test/proposal-acceptance.test.ts test/tasks.test.ts test/reports.test.ts test/validation-acceptance.test.ts`.
Generic report ingestion cannot request `taskTransition=validated` or
`stageTransition=completed`. Task create/update cannot grant `validated` status;
update also refuses rewriting an already validated task. This includes embedded
validation commands: a rejected proposal does not replace its policy. A bundled
report cannot apply its stage transition before refusing task acceptance.
Ordinary non-accepting proposals continue to work, and refusals are audited.

Use dedicated validation and commit/skip operations for acceptance; do not work
around a refusal by editing state or evidence ledgers. Changes to an accepted
task require explicit replanning/replacement, not metadata edits retaining the
accepted label. These guards do not yet establish evidence authority for manual
validation reports/checklists, automatic acceptance or aggregate run completion.

### Automatic task validation acceptance (PLAN-104)

Run `node --test --import tsx test/automatic-validation-acceptance.test.ts test/validation-acceptance.test.ts test/validation-runner.test.ts`.
`runTaskValidation` and its execution-lock wrapper now apply the same current
receipt verifier as commit/skip before automatic Git acceptance. Empty checks or
only failing optional checks produce a blocked validation record, not accepted
progress. Required reasoned skips and actual passing checks remain supported.
Direct callers must supply current persisted state; stale snapshots are refused
before accepted Git records are published. Executed checks remain in the blocked
record for diagnosis. This is not independent semantic validation or complete
manual-report/checklist/run-completion authority.

### Manual validation claims (PLAN-105)

`applyValidationReport`, `scaler_validation_report` and manual checklists no
longer promote tasks for caller-supplied `passed` or `not_applicable`. Positive
claims and checklist evidence-reference strings are retained in the audit
history, with `accepted=false` and a supervisor-verification diagnostic. A
checklist record's `passed` status describes its reported items, not task
acceptance. The registered tool still accounts for its call even when refused.
Failed/partial/blocked observations retain their debugging/replanning behavior.

Run `node --test --import tsx test/manual-validation-authority.test.ts test/validation.test.ts test/automatic-validation-acceptance.test.ts test/validation-acceptance.test.ts`.
Actual supervisor command validation still accepts through current receipts and
Git checks. Non-software acceptance needs an independent verifier that is not yet
implemented; do not fabricate evidence, add dummy commands or treat a second
model's agreement as a substitute. This is an explicit capability limitation,
not a claim of complete P2.3 or SC-10 support.
# Completion provenance regression

PLAN-119 covers final SCALER prompt admission. Conductor and debug retry measure
the fully rendered task prompt rather than trusting context-item estimates, and
refuse an oversized or malformed allowance before runner, attempt, task-state or
spawn-budget effects. The regressions cover oversized required exact context,
understated item estimates, wrapper-only overflow, debug retry, non-finite
explicit/persisted allowances and sufficient-budget controls. Run
`node --test --import tsx test/conductor.test.ts test/debug-retry.test.ts test/context.test.ts test/context-splits.test.ts`.
This remains the early SCALER-owned-envelope gate.

PLAN-120 adds strict provider-payload admission for executable conductor and
debug-retry children using the installed Pi 0.80.3 OpenAI Chat Completions
adapter. Pure tests cover the final serialized system/tool/history/tool-result
payload, UTF-8 sizing, task/model limits, useful output reserve, margin,
malformed limits, audio/images and multiple completions. Subprocess tests cover
ambient-resource suppression, extension ordering and numeric-only policy
transport. Installed-host SDK tests replace `fetch` before session creation and
make no network request; they prove that `ctx.abort()` stops an oversized
request, that throwing does not, that a sufficient request still reaches the
stub, and that strict children cancel provider-backed auto-compaction because
Pi's compaction route bypasses the provider-request hook. Run
`node --test --import tsx test/provider-admission.test.ts test/provider-admission-host.test.ts test/subagents.test.ts test/conductor.test.ts test/debug-retry.test.ts`.
This is not tokenizer-accurate evidence and does not validate alternate provider
APIs, real model quality, token savings or scale.

PLAN-121 replaces file `scope: "section"` prefix truncation with explicit,
exact Markdown-heading selection. The conductor fixture puts the required
section after a 72k-character unrelated prefix and proves that the actual worker
prompt contains only the selected section (including nested headings), not the
prefix or following peer section. Missing selectors/headings, ambiguous matches
and oversized selected sections fail before runner, attempt, task-transition or
spawn-budget effects. Fenced pseudo-headings, nested/lazy list containers,
blockquote termination, ordered-list interruption, strict fence closing syntax,
duplicate references, HTML/container exclusions and two selectors for one file
are covered. Unicode and LF/CRLF/standalone-CR fixtures assert exact original
substrings, including Setext section boundaries. Run
`node --test --import tsx test/context.test.ts test/conductor.test.ts test/debug-retry.test.ts`.
This is bounded ATX-heading retrieval, not AST/semantic retrieval or automatic
task splitting.

PLAN-122 binds every admitted file-backed context item to the complete source
bytes used to render it. The durable attempt stores normalized path, scope,
selector, byte fingerprint and exact-output eligibility. Sources are re-read
before dispatch and before accepting the worker report. Missing, changed,
replaced, symlink-backed or non-regular sources fail closed before successful
report persistence, validation accounting or completion evidence. A direct
regular file may change after dispatch only when it is an exact declared output
inside the existing write scope; an allowed-prefix match alone is insufficient.
Budget-omitted and inline context retain their prior behavior.

Run `node --test --import tsx test/context.test.ts test/attempt-execution.test.ts test/conductor.test.ts test/debug-retry.test.ts test/task-attempts.test.ts`.
The regressions include selected-section ambiguity, deletion, byte-level drift,
descriptor tampering, legacy open attempts, exact-output controls, leaf and
ancestor symlinks, and FIFO replacement. This check is not a filesystem
transaction or authenticated writer attribution: change-and-restore and a race
after the final read remain explicit limitations.

PLAN-126 bounds the isolated tool-worker transport and structured result
acceptance introduced by PLAN-125. `runTaskAgent` counts raw stdout/stderr bytes
before streaming UTF-8 decode, retains no bytes beyond the 4 MiB/1 MiB caps and
terminates through the existing confirmed TERM/KILL lifecycle. The parent
accepts a result only when both observed transport counters are present and
valid, no limit was crossed, the durable execution still carries the exact
runtime-owned limits, and the proposed plus accepted compact-JSON result stays
within 1 MiB. Missing or malformed counters are not inferred from decoded text.

Run `node --test --import tsx test/subagents.test.ts test/tool-requests.test.ts test/tool-ledger-concurrency.test.ts test/tool-routing.test.ts`.
The focused coverage includes split UTF-8, newline-free output, large crossing
chunks, stderr overflow, a TERM-ignoring overflow child, a proposal followed by
overflow, malformed/missing measurements, deep nested JSON, durable byte/limit
tampering, replay, schedule, iteration and concurrent ledger publication. The
compact result size is an acceptance and persistence bound for one record, not
a child memory/filesystem sandbox or total historical-ledger quota. PLAN-124
route advice remains non-authorizing until dispatch-time provider evidence and
caller-continuation identity have a trusted live supplier; these tests do not
prove SC-08/AC-08, local-model quality, savings or scale.

PLAN-127 adds the missing dispatch-time admission boundary. Every executable
isolated tool run, replay, iteration step and schedule step must receive fresh
host-owned worker and caller-continuation provider evidence bound to a newly
allocated execution identity. SCALER rebuilds the request basis from its durable
tool request, recomputes PLAN-124 routing and admits only the isolated route.
Missing, throwing, malformed, foreign, stale or non-isolated evidence records a
rejected transaction before runner invocation and without consuming replay
approval. The claim then atomically rechecks the request and final strict child
invocation before taking ownership.

The admitted worker API/provider/model/context window is transported through
strict provider admission. The installed Pi hook aborts before provider
transport if the live model identity differs. The new route-admission receipt
retains compact request, invocation, route-evidence and selected-profile
fingerprints plus the overhead bound; it does not add supplier provider payloads
or messages. The existing transaction record still retains its replay invocation
and rendered child prompt. Finalization rejects a result if the durable admission
receipt is missing or changed.

Run `node --test --import tsx test/provider-admission-host.test.ts test/subagents.test.ts test/tool-routing.test.ts test/tool-requests.test.ts test/integration/mock/tool-request-flow.test.ts` for the focused host, route, replay and result boundary, and
`node --test --import tsx test/tool-ledger-concurrency.test.ts` for separate
worker-process publication. The final candidate passes build, 960 unit/component
tests, 67 mock integration tests and 7 conformance/autopilot checks.

The installed command surface still cannot observe a trustworthy future caller
continuation envelope, so execution fails closed there while preparation stays
available. Synthetic evidence is limited to tests and does not establish a
production supplier, route execution completeness, local-model quality, token
savings or scale. SC-08/AC-08 remains partial.

PLAN-128 revalidates fresh-context handoff evidence before prompt publication.
Run `node --test --import tsx test/context-compaction.test.ts test/context-splits.test.ts`
for exact-inline preservation plus malformed/foreign ledger, missing minimal
item, mutated/deleted/symlinked source, hash/header/alias substitution and legacy
execute-refusal coverage. Preparation writes no prompt for invalid source or
identity evidence, and malformed handoff evidence is preserved rather than
overwritten. The `execute` argument invokes no runner; normal conductor
admission remains the only executable task-agent boundary. These checks do not
prove automatic effective splitting, a live continuation supplier, route
execution, local-model quality, savings or scale.

The PLAN-128 candidate passes the TypeScript build, `git diff --check`, 978 unit
and component tests, 67 mock integration tests and 7 conformance/autopilot
checks. These are repository-owned gates; no paid or deployed model execution is
claimed.

PLAN-113 requires declared `outputPaths` before automatic non-Git/clean/runtime
commit skips or explicit commit skips can accept a task. A successful command
may still have `status: passed` while `acceptance.accepted` is false; callers
must honor the latter. Declare outputs through the existing plan/task/manifest
inputs and rerun validation. Do not insert [] automatically for old manifests.
Real commits retain their committed-output proof path.

`test/skip-output-admission.test.ts` covers six earlier false-acceptance cases.
Existing output and orchestration fixtures now declare their actual basis while
preserving assertions. Historical completion tests still independently reject
old accepted skip records with unknown coverage. Declaration adequacy/authority
and final semantic/integration checks remain separate, incomplete requirements.

PLAN-114 treats `validatedTaskIds` as a scheduling hint, not sufficient proof for
dependent execution. Before conductor or debug-retry worker admission, every
direct `dependsOn` task must still have current accepted validation/Git/output
evidence. A stale dependency refuses before runner invocation, attempt creation,
task transition or `spawnedAgents` accounting. Reconcile and revalidate the
dependency; SCALER does not replay the worker or repair evidence automatically.

Run `node --test --import tsx test/dependency-evidence-admission.test.ts test/debug-retry.test.ts`
for the stale-output reproduction, current dependency, shared admission,
unrelated-task control, both late-race budget checks and fail-closed conversion
of Git snapshot errors into dependency-scoped refusals.
Selection remains synchronous and label-based; admission supplies the durable
check. This does not infer dependencies or establish transitive
semantic/integration correctness.

PLAN-115 requires an execution-complete task contract before conductor or debug
retry can dispatch a worker. Declare at least one project write-scope prefix,
an explicit validation-manifest `outputPaths` value, and a task/manifest
Definition of Done or manifest acceptance criterion. Use `outputPaths: []` only
when the task deliberately has no filesystem outputs. Preparation remains
available for diagnosis; execute mode fails closed before attempt or agent-budget
publication and before dirty-tree pause checkpointing. Run
`node --test --import tsx test/task-contract-admission.test.ts test/debug-retry.test.ts`
for the direct, shared, late-race, git-safety-ordering, malformed legacy shape and
compact-contract checks.

PLAN-112 carries optional `outputPaths` through execution-plan tasks, structured
task create/update tools and stage child planning reports into the existing
validation manifest. Omit it to preserve a prior declaration; [] is an explicit
empty declaration. Paths without replacement commands keep existing/default
commands. Invalid declarations fail before task/manifest or plan publication;
validated tasks still reject metadata rewrites. The positional CLI is unchanged;
the manifest tool remains available for separate configuration.

`test/planned-outputs.test.ts` and the full autopilot fixture exercise these paths,
including strict path rejection and preservation of commands. This transports a
basis; it does not certify its adequacy or authorize changes to acceptance policy.

PLAN-110 adds `outputPaths` to the existing validation manifest and
`scaler_validation_manifest_write` tool. Declare exact project-relative output
files before validation, for example `"outputPaths": ["report.md", "data.csv"]`.
The receipt binds their bytes, executable mode, symlink target or absence before
and after checks, at direct commit/skip, and on completion/restart, independently
of Git. Symlink targets are not followed; declare referenced files separately
when their contents matter. Directories, globs, traversal and runtime metadata
are refused. File content hashing streams data.

Omitted paths mean unknown filesystem coverage; `[]` binds no filesystem outputs.
Neither establishes that the task's real expected outputs were fully declared.
PLAN-111 requires that declaration for final run completion of every skipped
task without verified committed outputs. It preserves historical state on refusal
and requires declaration/revalidation; it does not infer [] for missing data.
PLAN-113 applies the same missing-basis refusal at per-task skip admission.
Policy-authorized declaration completeness and semantic/integration acceptance
remain open. Legacy receipts need revalidation, not hash migration.

Run `node --test --import tsx test/declared-outputs.test.ts`. Nineteen checks cover
post-validation mutation, successful commands that mutate outputs, deletion,
mode/symlink changes, policy drift, unsafe paths, large files, the public tool,
independent tasks, unchanged completion and restart. Eleven baseline acceptance
failures were reproduced before the implementation; two positive controls passed.
PLAN-111 adds four unknown-coverage rejection cases for execution/restart and
an explicit no-filesystem-output positive control. Planning/command updates
retain a previously configured output basis. File-producing chain fixtures
declare their actual checked files and keep their original completion assertions.

PLAN-109's `test/hidden-git-candidates.test.ts` verifies that commit/skip cannot
reuse a receipt after edits hidden by assume-unchanged/skip-worktree or after an
index-only change. Unchanged flagged files and staged runtime-only bookkeeping
remain positive controls. Pre-change receipts require revalidation under the
extended candidate identity; no acceptance proof is fabricated during migration.

PLAN-108's `test/git-decision-evidence.test.ts` covers the direct Git-decision API:
bare/empty/tampered/stale evidence cannot publish accepted skips; full verified
records produce correctly derived summaries. Git and non-Git controls remain.

`test/completion-artifacts.test.ts` (PLAN-107) additionally rejects drift of
accepted committed outputs, missing/orphaned commits, incorrect path lists,
recreated deletions, index-only edits and changes hidden by Git index flags.
It reads actual bytes/modes/targets instead of trusting Git status. Independent
later commits remain valid when earlier outputs are unchanged. Filtered/CRLF
worktrees and submodules may be refused pending an explicit normalization or
provider contract. Skip/non-Git output freshness and final integration remain open.

`node --test --import tsx test/completion-provenance.test.ts` exercises legacy
execution/completed labels, stage-artifact and wrapper completion, changed
run/task/policy/result evidence, missing Git acceptance, newer failed validation,
execution-lock contention, non-Git acceptance/restart and two real sequential
task commits. Positive chain fixtures use command-checked evidence. PLAN-106
establishes provenance only; accepted artifact freshness and final integration
remain separate acceptance work. Passing this suite is not full SC-26 compliance.

PLAN-116 extends the same suite with current runtime-requirement coverage. It
reproduces and rejects an unlinked requirement and a stale explicit link to a
nonexistent task, while retaining a linked, validated control. The staged
integration fixture declares its `REQ-STAGE` task link explicitly. These checks
establish structural final coverage only, not semantic linkage or cross-task
integration adequacy.

PLAN-117 additionally changes a linked requirement after validation and verifies
that the old receipt cannot complete the run. A missing-to-present requirement
reference is also rejected, while an identical content upsert remains current.
Validation snapshot schema version 3 binds requirement id/statement/title/source;
version 1 and 2 receipts require revalidation. This is version freshness, not
proof that the selected requirement links or integration checks are sufficient.

PLAN-118 unit A covers explicit coverage-ledger links as well as task `prdRefs`.
Run `node --test --import tsx test/completion-provenance.test.ts test/validation-acceptance.test.ts test/dependency-evidence-admission.test.ts test/declared-outputs.test.ts`.
Four baseline failures demonstrate false completion after changed/new explicit
links and stale receipts after removed/retargeted links. Unchanged/idempotent and
unrelated-task controls remain valid. Both directions feed the existing canonical
requirement-content fingerprint; the schema and acceptance routes are unchanged.
After PR #21 reconciliation, the same suite also refuses malformed content and
duplicate linked identifiers reached only through coverage `taskIds`, as well as
through task `prdRefs`. A malformed requirements document fails with a stable
diagnostic rather than being treated as missing evidence.

PLAN-118 unit B adds `test/requirement-integration.test.ts`. Two negative
baselines show that linked component success previously allowed completion when
the named end-to-end command was missing or skipped. Current checks reject both,
accept one exact required passing command, and reject the old integration receipt
after a component output changes and is independently reaccepted. Rerunning the
named command restores completion. PRD, tool and stage-workflow tests also cover
criterion normalization and preservation through all structured input paths.
Snapshot schema version 4 introduced this integration identity. The current
schema is version 5 because declared validation-input files are also bound; all
older receipt versions require revalidation.
Malformed or duplicate stage-provided criteria are refused before any PRD,
catalog, stage-artifact or accepted audit write; malformed participant arrays are
not silently narrowed.

The test proves deterministic command evidence and current component identity;
it does not prove that an agent had authority to create/delete the criterion,
that the selected criterion is semantically sufficient, or that non-software and
real-model outcomes meet their requirements.

PLAN-118 unit C adds revision-checked local-user PRD amendments and immutable
requirement history. `test/prd.test.ts`, `test/plans.test.ts`,
`test/stage-workflow.test.ts`, `test/commands.test.ts`, and
`test/completion-provenance.test.ts` cover model-route refusal, whole-catalog
preservation, stale revisions, serialized concurrent writers, batch refusal with
no partial ledgers, source-less idempotence, JSON containing `|`, invalid-plan
ordering, and A→B→A evidence invalidation. The supported writer paths use an
exclusive PRD publication lock and atomic JSON replacement; a held lock is never
stolen by age.

Unit C gate: TypeScript build, 743 unit tests, 67 mock integration tests and 7
conformance/autopilot checks pass. GPT-6 Astra/high independently reviewed the
implementation and all review findings were corrected. These checks do not
authenticate arbitrary filesystem writers, prove semantic requirement necessity,
or establish representative real-model/local-model outcome quality.

PLAN-118 unit D closes reproduced Git and policy-authority routes. The Git
regressions refuse clean/runtime-only commit skips without declared outputs,
reject pre/post-commit hook changes before publishing accepted evidence, and
preserve the resulting Git commit for diagnosis instead of resetting it.
Dependency admission runs before validation commands and budget consumption.

`test/acceptance-policy-authority.test.ts` covers exercised command/DoD/link
replacement, idempotent metadata preservation, explicit user corrections with
reason/history/revision, concurrent amendments, stale revisions, and rejection
before planning/replan publication. Barrier-controlled first-validation tests
exercise both policy replacement and unchanged-policy stale-state paths. The
lock-owner lifecycle regression checks that a detached descendant cannot reuse
reentrant ownership after release. `test/commands.test.ts` covers the amendment
reason parser.

Policy writes, task updates, planning/replan publication and validation share a
bounded policy lock; task/planning/replan callers must present a current state
revision after acquiring it. The lock is never stolen by age. An interrupted
holder requires operator reconciliation; a waiting operation can fail after
approximately two seconds. These are supported-route concurrency guards, not a
transaction across every ledger, process authentication, semantic test adequacy,
or evidence of real/local-model outcome quality.

PLAN-118 unit E adds `validationInputPaths` to the existing validation policy.
Declare every existing local checker, fixture, or validation-only configuration
file that a command depends on. Paths are exact project-relative regular files;
missing files, symlinks, duplicates, absolute/traversal paths and `.scaler`
runtime metadata are rejected. `[]` is an explicit assertion that the commands
are self-contained. Omission preserves an existing task declaration but provides
no protection for an undeclared dependency.

The policy records a canonical SHA-256 basis fingerprint and checks it before and
after command execution and at receipt/commit/skip/completion freshness gates. A
model cannot rebaseline an exercised policy. A genuine correction uses the
existing explicit user-authorized manifest amendment with a reason, revision and
policy history. Planning preflights explicit and inherited declarations before
publishing requirements, plans or task changes. If the task creates its own
validator, create it first and write the manifest before the first validation.

Run `node --test --import tsx test/acceptance-policy-authority.test.ts test/validation-acceptance.test.ts test/plans.test.ts test/tools.test.ts test/stage-workflow.test.ts test/replan-agent.test.ts` for the focused basis, authority, transport and publication coverage. These checks protect only declared local files; they do not infer shell dependencies, prove declaration completeness or establish semantic/real-model outcome quality.

PLAN-118 unit F distinguishes a model-owned unexercised manifest draft from an
acceptance policy already established by the system or an explicit local user
command. Public manifest writes, task updates and planning reports cannot weaken
an established manifest before its first validation. Idempotent writes and
model-owned draft refinement remain supported; an operator correction requires
the same explicit reason, revision and version history used after exercise.
Legacy manifests without provenance reject material model changes. This is an
authority boundary only: it does not prove semantic test sufficiency or assign
provenance to every unexercised task metadata field.

The Unit F regression set also covers provenance laundering through an
idempotent legacy write, replacement of an exercised generated default,
preconfigured manifests for tasks not yet in state, and a positive unchanged
inheritance control. Final validation passes the TypeScript build, full unit
suite, 67 mock integration tests and 7 conformance/autopilot checks; two
independent GPT-6 Astra/high exact-head reviews report no remaining finding.

PLAN-118 unit G adds adversarial pre-commit and post-commit hook coverage for
declared validation-basis files. After a Git commit is created, SCALER rechecks
task outputs, Git safety and the current validation receipt before publishing a
commit report or promoting the task. The receipt comparison excludes only the
Git candidate identity, because the successful commit itself advances that
identity; checker bytes, policy, task contract, PRD and integration evidence
must still match the validated snapshot.

When a hook changes a declared checker, the resulting commit is intentionally
kept for operator diagnosis, but acceptance is refused and no commit report is
recorded. Run `node --test --import tsx test/validation-acceptance.test.ts` for
the focused regression. The reconciled exact candidate passes the TypeScript
build, 799 unit tests, 67 mock integration tests and 7 conformance/autopilot
checks. These tests do not make arbitrary hooks transactional or authorize an
automatic reset/replay.
