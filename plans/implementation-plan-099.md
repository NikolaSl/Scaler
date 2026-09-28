# PLAN-099 — Requirements v2 migration

## Authority and baseline

The user authorized an implementation plan and the start of incremental code
migration, with separate traceable commits. Requirements PR #1 was merged as
`8f4cf197cfb399914d06312193d9921c11b270e0`. The normative catalog remains
`requirements-catalog.md`; its 27 requirements are not replaced by this plan.

Implement through reviewed increments on topic branches. Do not claim v2
compliance or deploy unattended operation while acceptance/authority bypasses
remain. Merge authority follows the current user instruction below. This plan
is a durable continuation record; scheduled execution is recorded separately.

### Current authorization and review policy

Nikola explicitly authorized autonomous implementation and merging PRs after
review when there are no valid unresolved findings and applicable tests pass.
Nikola renewed unattended work for 24 hours on 2026-09-27 at 20:10:01Z. The
current mutation deadline is `2026-09-28T20:10:01Z` (23:10:01 Europe/Sofia),
superseding earlier cutoffs. Check live ownership and time before changes; stop
mutations, save a durable handoff and release ownership before the deadline.
No paid model spending or deployment is authorized.

- On 2026-09-27 Nikola replaced Copilot as the mandatory reviewer with an
  independent assistant agent using a lighter model, explicitly suggesting
  GPT-5.6 Terra. Review the exact candidate head with Terra/high, preserve
  concrete findings and reasoning in the PR/handoff, and have the primary
  agent independently review and run the applicable exact-head gate. Fix valid
  findings and re-review a changed head. A Copilot request or old Copilot
  review is not a merge gate under this newer instruction. No external paid
  model calls are authorized.
- The PR author assesses every reviewer finding against the requirements and
  complete context. Fix a valid finding or record a concrete, evidence-backed
  reason it does not apply. Supply missing context to the reviewer and recheck
  disputed findings; unresolved material findings block acceptance. Record
  each disposition with the reviewed commit identity. The same local model may
  author and review sequentially in separate contexts.
- Merge only the reviewed, tested head using an expected-head-SHA guard and a
  merge commit to preserve implementation history. Respect branch protection.
- Keep paid model spending and deployment out of scope. Existing free-provider
  synthetic tests are permitted; do not disclose credentials.
- Continuations must inspect current remote state before acting and avoid
  overlapping work. Claim a checked, bounded ownership marker and release it at
  handoff; marker age alone never proves that a live worker is dead. Scheduling
  details are recorded separately and do not guarantee execution tools or phase
  completion. Report concrete blockers.
- Group subsequent work into coherent phase PRs: remaining P2, then P3, etc.
  Keep separate logical commits for planning, reproductions, implementation,
  tests, documentation and review fixes. A new plan does not require a new PR.
  Choose the smallest implementation that satisfies the explicit acceptance
  boundary; do not add architecture or tests without a concrete requirement or
  reproduced risk.
- Prepare the next dependency-ordered unit while a PR is in review, using a
  separate branch for dependent changes. At most one PR is in review and one
  next unit is in preparation; do not merge before prerequisites are merged.
  Do not spend active work repeatedly sleeping or resending the same review
  request. A successful API response is not a completed review.
- The review delegate uses GPT-5.6 Terra/high under Nikola's newer instruction.
  Other delegated implementation work follows any separately authorized model
  constraint; do not silently substitute a weaker model.
- Report meaningful published commits in Bulgarian with commit links, purpose,
  validation and next action. Group related commits when necessary; do not make
  empty reporting commits or repeatedly announce an unchanged pending review.
- PRs #3-#22 are merged. The coherent remaining-P2 PR #22 merged on 2026-09-20
  as `55bfcc034cb0b570be144f549c040e731ee89e4c` after raw exact-head review
  commit-id verification for `95c5ea6fe0bdf2cc5ba5e84ca09866a2a68fece8`,
  resolved threads, two independent reviews and a full gate. P3 is reconciled
  with that result. PLAN-119 through PLAN-121 cover SCALER prompt admission,
  provider-envelope admission and exact Markdown-section retrieval. PLAN-122
  binds admitted file context to its source bytes across dispatch and result
  acceptance, including exact-output, symlink and non-regular-file boundaries.
  After its exact-head gate and reviews, reassess the remaining P3 acceptance
  matrix before selecting the next bounded unit; do not infer phase completion
  from these isolated components. PLAN-123 corrects first-request active-tool
  timing in the installed host, binds the selected definitions to a measured
  identity and fails closed on unsupported prompt composition. PLAN-124 adds a
  non-authorizing per-request route assessment over complete concrete
  provider-envelope evidence. It measures every route leg, requires explicit
  current-agent or worker/continuation roles, fails closed on malformed runtime
  evidence and records only compact advice. Route execution remains a later
  unit; neither PLAN-123 nor PLAN-124 is AC-08 completion.
  PLAN-125 first closes the isolated executor's result-acceptance prerequisite:
  child results become execution-bound proposals, only a successful parent-
  observed process outcome may close the request, and scheduled tool work is
  sequential. Replay approval is reserved atomically with the execution claim,
  stale finalizers preserve replacement ownership, and request closure is the
  last multi-index publication. Provider-envelope admission and route execution
  remain later units; PLAN-125 is not AC-08 completion. PLAN-126 bounds the
  isolated subprocess transport and compact serialized execution-bound result:
  raw-byte stdout/stderr caps terminate the owned child, actual measurements and
  immutable result bytes are rechecked at finalization, and unknown measurements
  fail closed. Measurement and ledger publication now use the same compact JSON
  representation. PLAN-124 advice deliberately remains non-authorizing because
  the live worker and caller-continuation envelopes do not yet share a trusted
  dispatch-time supplier. PLAN-126 therefore closes an execution prerequisite,
  not SC-08/AC-08 or any quality/savings claim. PLAN-127 makes a fresh trusted
  supplier mandatory immediately before isolated execution, binds its worker
  and caller-continuation evidence to the claimed request/execution identity,
  binds the exact selected worker model into strict provider admission, and
  fails closed when that supplier is unavailable. Replay approval is consumed
  only after a fresh admission and atomic execution claim. The installed Pi command
  surface cannot yet supply a trustworthy future continuation payload, so
  execution remains unavailable there instead of reconstructing or inventing
  one. This closes an unsafe dispatch default but still does not complete
  SC-08/AC-08. PLAN-128 applies the same fail-closed discipline to the legacy
  fresh-context handoff route: preparation revalidates complete minimal-item and
  externalized-source provenance without clipping exact bytes, while `execute`
  refuses before the runner until conductor-equivalent attempt, provider and
  result admission exist. It does not complete automatic effective splitting,
  SC-07, SC-08 or AC-08. PLAN-129 applies the existing prompt and provider
  admission boundary to the shared stage-agent path. PLAN-130 then closes the
  five reproduced remaining child-launch bypasses: research, diagnostic debug,
  replanning, tool-schema discovery and explicit task spawn. Oversized or
  malformed prompts now refuse before child dispatch and successful/prepared
  run publication, and admitted requests carry the strict provider policy.
  Unsupported browser/MCP/custom extension grants also refuse rather than being
  promised to a child whose isolated loader cannot provide them; a trusted
  external-capability adapter remains open. PLAN-131 makes that loaded-tool
  check intrinsic to every strict child invocation, including conductor, debug
  retry, stage agents and isolated tool execution/replay. Callers cannot disable
  it with the legacy opt-in flag; malformed or sparse runtime grants also return
  structured refusal before attempt, budget, run-record or execution-claim
  publication. PLAN-132 then makes the exact host-selected API/provider/model/
  context-window identity mandatory for every strict child. The same trusted
  identity renders explicit `--provider` and `--model` selectors, is transported
  to the final provider hook, and fingerprints task attempts. Missing,
  malformed or conflicting identity refuses before dispatch or execution-side
  publication; model-authored explicit-spawn selectors cannot override it.
  Isolated-tool dispatch retains its fresher supplier-owned binding.
  PLAN-133 closes the reproduced cross-invocation stage-artifact acceptance
  bypass: failed or throwing children quarantine only artifact records added or
  changed during their run, failed run records retain those artifact ids, and
  conductor/workflow resume refuses the blocked artifact until explicit
  replacement. This is a parent-observed process boundary, not authentication
  of arbitrary filesystem writers or a crash-atomic multi-ledger transaction.
  PLAN-134 replaces the initial English domain-keyword and raw-length
  escalation with bounded request-effect evidence. Equivalent English and
  Bulgarian lookups, workspace changes and multi-workstream changes now select
  equivalent routes; domain or complex-work nouns and advisory action mentions
  remain lightweight. Imperatives, polite modals and explicit follow-on changes
  preserve their requested workspace, planning or external-effect route. This
  includes request-position checks for ambiguous action nouns/response phrases
  and common create/edit forms. It does not establish general multilingual
  semantics, justified isolated execution or risk-triggered direction checks.
  PLAN-135 then closes the reproduced ordinary parent-provider bypass: the
  installed extension evaluates the exact final payload with the live model
  context window, explicit output reserve and safety margin before transport.
  Prompt-composition refusal keeps precedence, child policy remains separate,
  and compact telemetry contains no prompt/tool bytes. Provider-internal retry
  interception, alternate provider payloads and exact tokenization remain open;
  this is not SC-05/AC-05 completion.
  PLAN-136 adds exact explicit `typescript-function` context selection for one
  unique named top-level JavaScript/TypeScript function or callable variable.
  Parser-backed selection preserves original source bytes, round-trips through
  durable attempt identity and fails closed on ambiguous, malformed,
  unsupported or oversized input before dispatch. Automatic selector discovery,
  cross-file semantic lookup and automatic effective splitting remain open, so
  SC-07/AC-07 stays Partial.
  PLAN-137 adds a deterministic, non-authorizing model-profile eligibility
  boundary. It validates exact provider identity, locality, tokenizer/estimator,
  tools, structured output, limits, data locations and observed task suitability,
  then applies request-specific constraints without selecting or falling back to
  a model. No installed dispatch consumes the assessment and no local inference,
  quality or resource evidence exists, so SC-09/AC-09 remains Not assessed.
  PLAN-138 closes the bounded effective-split gap for normal isolated task-agent
  execution. When a just-created split externalizes large context, conductor
  revalidates its task/item identity, memory ledger, immutable bytes and source
  fingerprints, replaces the oversized bytes with read-only refs, and measures
  the complete attempt-bearing projected prompt. Dispatch continues only when
  that prompt both shrinks and fits; the projected input and original plus
  externalized sources remain freshness-bound through result acceptance. The
  legacy direct handoff executor stays blocked. Automatic selector discovery,
  cross-file semantic lookup and task decomposition remain open, so SC-07 and
  the broader P3 acceptance matrix remain Partial.
  PLAN-139 adds an exact-name discovery bridge for the existing function
  selector. An explicit `function:<identifier>` candidate query searches the
  bounded allowed-path file set, verifies each declaration through the same
  parser-backed exact selector, and returns separate path-bound candidates that
  still require manual approval. Malformed declarations, unsupported files,
  unrelated changed paths and premature candidate-limit starvation fail closed.
  Natural-language inference, import/call-graph lookup, automatic selector
  choice and task decomposition remain open, so SC-07/AC-07 stays Partial. The
  candidate passes build, 1,112 unit/component, 67 mock integration, 7
  conformance/autopilot and 67 focused context checks plus `git diff --check`.
  PLAN-140 applies that bounded discovery bridge to the existing Markdown
  selector. An explicit `heading:<text>` candidate query searches only allowed
  Markdown paths and returns a path-bound candidate only when the same
  CommonMark-backed exact selector finds one unique, within-limit heading.
  Empty queries, duplicate or fenced headings, unsupported files, oversized
  sections, unrelated changed paths and premature candidate-limit starvation
  fail closed. Approval remains manual. Natural-language or fuzzy inference,
  document-link lookup, automatic selector choice and task decomposition remain
  open, so SC-07/AC-07 stays Partial. The exact-head candidate passes build,
  1,117 unit/component, 67 mock integration, 7 conformance/autopilot and 72
  focused context checks plus `git diff --check`.
  PLAN-141 extends PLAN-138's effective split execution boundary to debug
  next-approach retries. The next-approach instruction is part of the split
  basis; externalized exact context requires `read`; the complete attempt-bound
  projected prompt must both shrink and fit; and returning results retain
  freshness bindings to externalized evidence. Projection failure refuses
  before attempt admission, spawned-agent accounting or dispatch. Automatic
  retry policy, selector inference, task decomposition, model quality and
  savings remain outside this unit, so SC-07/AC-07 stays Partial.
  The candidate passes build, 1,120 unit/component, 67 mock integration, 7
  conformance/autopilot and 44 focused checks plus `git diff --check`.
  PLAN-142 closes the next bounded effective-split trigger gap: caller-provided
  item estimates cannot hide actual large exact/summary-ok bytes, and a complete
  attempt-bearing prompt that exceeds a valid allowance may trigger the existing
  projection even when context-only usage stays below its 75% target. Wrapper-only
  and non-shrinking cases still refuse. This does not add semantic inference,
  decomposition, a new executor or model-quality/savings evidence. Split
  records distinguish active-context and final-prompt triggers and retain the
  measured prompt overage; SC-07/AC-07 stays Partial. The candidate passes
  build, 1,122 unit/component, 67 mock integration, 7 conformance/autopilot and
  95 focused checks plus `git diff --check`.
  PLAN-143 addresses the remaining aggregate accounting gap: compression must
  use the greater of a valid supplied total and the summed measured/conservative
  item estimates, so multiple understated inline items cannot suppress the
  active-context target, split evidence or overage. It does not invent an
  externalization candidate or add semantic retrieval/decomposition. The
  implementation clamps aggregate arithmetic to a safe integer and preserves a
  more conservative supplied total. Conductor execution publishes this same
  measured aggregate to active-context budget accounting rather than trusting
  the caller total. The candidate passes build, 1,125 unit/component, 67 mock
  integration, 7 conformance/autopilot and 58 focused checks plus
  `git diff --check`; SC-07/AC-07 stays Partial.
  PLAN-144 adds one deterministic cross-file document bridge. An explicit
  `link:<label>` query parses CommonMark link nodes in the bounded allowed
  Markdown source set, matches rendered labels exactly, resolves only relative
  local file destinations and returns unique path-bound targets for manual
  approval. External, absolute, escaping, queried, fragmented, fenced, symlinked
  or non-regular destinations fail closed. Natural-language inference, recursive
  crawling, code import/call-graph lookup, automatic approval and decomposition
  remain open, so SC-07/AC-07 stays Partial. The exact-head candidate passes
  build, 1,129 unit/component, 67 mock integration, 7 conformance/autopilot and
  76 focused context checks plus `git diff --check`.
  PLAN-145 adds the corresponding deterministic local-code bridge. An explicit
  `import:<specifier>` query inspects parser-backed static JavaScript/TypeScript
  import and re-export declarations, resolves only relative extension-explicit
  source targets inside the workspace and task path boundary, and returns unique
  path-bound candidates for manual approval. Package/alias resolution, dynamic
  imports, recursive symbol traversal and automatic selection remain outside
  this unit. The exact-head candidate passes build, 1,134 unit/component, 67
  mock integration, 7 conformance/autopilot and 81 focused context checks plus
  `git diff --check`; SC-07/AC-07 stays Partial.
  PLAN-146 composes that local-code bridge with the existing exact function
  selector. An explicit `import-function:<specifier>#<identifier>` query
  requires a parser-backed static named import or re-export, an
  extension-explicit relative target inside workspace/task scope, and one
  direct exported top-level function or callable variable with the exact source
  name. The path-and-selector-bound section candidate still requires manual
  approval. Default/namespace/type-only bindings, indirect exports, package or
  alias resolution, dynamic loading, recursive traversal and automatic choice
  remain unavailable. The exact-head candidate passes build, 1,139
  unit/component, 67 mock integration, 7 conformance/autopilot and 86 focused
  context checks plus `git diff --check`; SC-07/AC-07 stays Partial.
  PLAN-147 closes AC-08 scenario (a) for one exact read-only operation. A
  structured tool request may persist only the built-in compact catalog-entry
  adapter and one exact tool name. Dispatch creates a fresh runtime-owned direct
  route snapshot, binds request, adapter arguments and a synthetic invocation to
  the execution claim, runs without Pi/model/MCP/shell, and retains the existing
  ownership and serialized-result acceptance limits. Argument or adapter drift,
  malformed operations and oversized results fail closed. Current-agent
  execution, production isolated continuation wiring, generic direct adapters
  and the complete three-route scenario remain open, so SC-08/AC-08 stays
  Partial and no quality or savings claim is made.
  PLAN-148 adds one bounded syntactic call-graph step without claiming semantic
  resolution. An explicit `import-caller:<specifier>#<identifier>` query
  requires a stable extension-explicit local target with one direct exported
  callable, maps an exact value-level named import to its local alias, and emits
  only top-level function/callable-variable selectors containing a direct call
  through that binding. Nested, shadowed, property, optional, constructed,
  tagged, malformed, ambiguous and symlink-backed evidence fails closed.
  Recursive graph traversal, symbol/type resolution, natural-language inference,
  automatic approval and decomposition remain open, so SC-07/AC-07 stays
  Partial. The exact implementation-and-documentation candidate passes the
  TypeScript build, 1,150 unit/component, 68 mock integration, 7
  conformance/autopilot and 91 focused context checks plus `git diff --check`.
  PLAN-149 extends that reverse lookup through exactly one local named re-export.
  An explicit `reexport-caller:<barrelSpecifier>#<identifier>` query requires an
  exact value-level named import, one stable regular barrel with one direct
  value-level named re-export, and one stable regular final target with one
  direct exported top-level callable. Only top-level callers containing a direct
  call through the exact local alias are emitted, and approval remains manual.
  Conflicting/direct/type/star, malformed, escaping, nested, shadowed and
  symlink-backed evidence fails closed. Package/alias resolution, inferred
  extensions, multiple or recursive barrels, semantic/type resolution,
  automatic approval and decomposition remain open, so SC-07/AC-07 stays
  Partial. The exact implementation-and-documentation candidate passes the
  TypeScript build, 1,155 unit/component, 68 mock integration, 7
  conformance/autopilot and 96 focused context checks plus `git diff --check`.

### Renewed continuation policy (2026-09-19)

PLAN-151 addresses the explicit missing-file request boundary: a stable,
regular task-scoped source is required in the context manifest before the
request resolves, and the retried prompt contains its exact bytes under normal
admission. Unknown-path discovery, narrower sections for oversized files,
model choice and decomposition remain open, so SC-07/AC-07 stays Partial.
The candidate passes build, 1,156 unit/component, 68 mock integration,
7 conformance/autopilot and 149 focused tests plus `git diff --check`.
PLAN-152 binds a complete, task- and request-matched research report to a
required attributed answer in the next task manifest before resolution. Partial,
foreign, contradictory and unresolved reports cannot unblock the task. The
report is a claim, not exact source bytes; automatic source discovery and
decomposition remain open, so SC-07/AC-07 stays Partial. The candidate passes
build, 1,158 unit, 68 mock integration, 7 conformance and 61 focused tests.
PLAN-153 delivers a bounded manual answer as required task context before
resolution and refuses summary-only resolution of exact file requests. Answer
truth and source discovery are not established; SC-07/AC-07 stays Partial.
The candidate passes build, 1,159 unit, 68 mock integration, 7 conformance
and 56 focused tests.
PLAN-157 reuses the PLAN-156 unknown-source FSM under declared synthetic
32,768- and 131,072-token provider windows. A source larger than the smaller
allowance is narrowed to its required exact heading, while both windows exclude
the unrelated source bytes, admit every dispatched prompt and carry the full
synthetic provider identity/policy binding. The injected runner does not execute
the installed host/provider hook. This validates the model-independent process
boundary, not a real local-model run, source truth, model quality or savings;
SC-07/AC-07 stays Partial.
PLAN-158 connects typed execution-time missing-context requests to the main
automation loop. It resolves one request at a time through the existing
memory/file/research boundary, grants local research only the normal project
inspection/report tools, and resumes a task only after complete matched
evidence is persisted in its manifest. Partial or malformed evidence stops the
call without an internal retry; internet, user and tool boundaries remain
explicit. The candidate passes build, 1,168 unit/component, 72 mock integration,
10 conformance/autopilot and 29 focused checks plus `git diff --check`.
This removes an operator step from the existing FSM but does not establish
source truth, automatic task/context choice, local-model quality or full
SC-07/AC-07 completion.
PLAN-159 requires matched memory candidate summaries to enter the task manifest
before a memory missing-context request resolves. The existing memory resolver
keeps source and validity metadata visible, full bodies remain excluded, and
missing, unavailable, conflicting or oversized candidates keep the task
blocked. A bounded per-task critical section serializes manifest merge and
request resolution so concurrent accepted requests retain both required items.
The accumulated phase candidate passes build, 1,177 unit/component, 72 mock
integration, 10 conformance/autopilot and 18 focused checks plus `git diff
--check`. It adds no new ranking or approval subsystem and does not establish
memory truth, automatic task/context choice, model quality, savings or full
SC-07/AC-07.
PLAN-160 adds one bounded current-agent tool route using the installed parent
session. It narrows active tools to the request grant plus the result tool,
recomputes route admission from each actual provider payload and exact selected
profile, binds the first admitted call to the complete provider/model identity,
and accepts only one runtime-bound structured result before restoring the prior
tool set. Current-agent memory retrieval is summary-only. Supervisor-mutating SCALER tools, direct operations, isolation
requirements, unavailable tools, identity or profile drift, excessive calls and
malformed results fail closed. The candidate passes build, 1,177 unit/component,
72 mock integration, 10 conformance/autopilot and 118 focused
extension/tool/provider-host checks,
including 15 installed-host checks, plus `git diff --check`. Production isolated continuation wiring,
generic direct/MCP adapters and the complete three-route scenario remain open,
so SC-08/AC-08 stays Partial; no model-quality or savings claim is made.
PLAN-161 reconciles the completed context evidence with the intended division
of responsibility: the model proposes a source, selector or pathless question;
the supervisor validates scope, authority, identity and the complete next
envelope. Existing exact-section, unknown-source, automation, memory-summary and
32K/128K scenarios satisfy SC-07 without requiring semantic inference or
automatic supervisor context choice. Independent review found and PLAN-161
closed the remaining pathless-research admission gap: each cited local file is
now task-scope checked, bound to its report-time SHA-256 identity and rechecked
through the normal manifest before retry. SC-07/AC-07 is Verified for this
model-independent process boundary. Configured local-host execution remains
SC-09/P7 work, and no source-truth, model-quality or savings claim is made.
PLAN-162 exercises the three existing tool routes as one model-independent FSM
scenario. Exact direct execution makes no model call; current-agent and isolated
requests preserve route admission, provider/model identity,
execution ownership and one bounded structured result under declared 32K and
128K profiles. A small selected operation is measured independently of its
large catalog, schema drift changes the profile identity, and unknown result
size blocks before dispatch. The prior 1 MiB result reserve made isolated work
infeasible at both acceptance windows, so the minimal runtime-owned cap is now
16 KiB with the same byte and ledger checks. Phase review found that this does
not yet complete SC-08/AC-08: current-agent route admission lacks a separately
bound runtime permission decision, isolated admission trusts its host-owned
supplier's authority evidence, and the scenario does not cover denied authority
or budget refusal across every route. SC-08 therefore remains Partial instead
of adding a speculative permission layer here. The unavailable final Pi
continuation envelope remains an SC-25 host-adapter limit; configured local-only
execution remains SC-09.
PLAN-163 closes the next minimal SC-05 boundary: a successful task-agent process
with a missing or malformed structured report may receive one separate
report-only repair call. The repair keeps the same attempt identity, has no
tools, passes the existing final-prompt and strict provider-envelope admission,
and cannot replay task effects. Missing, malformed, identity-mismatched,
budget-refused or oversized repair output remains blocked without a third call.
An installed-host fixture also proves that a large tool result is externalized
before the re-admitted continuation. This is not a general retry framework;
SC-05 stays Partial until the entire AC-05 sequence is one declared-window
scenario with estimate-versus-observed reconciliation, and broader attempt-
contract work stays in P4.
PLAN-164 composes that complete AC-05 sequence in an in-process installed-host
fixture using the production strict-child environment builder and equivalent
extension order; it is not one end-to-end Pi subprocess test. Separate
subprocess tests exercise the actual runner UUID/correlation/parser path. One
declared 32,768-token scenario externalizes
an oversized exact source into a resolvable split, admits the compact request,
uses the actually granted `read` tool, externalizes its large result before the
continuation, and admits one admission-only, tool-less, same-attempt report repair
before validation. A runtime-owned dispatch ID on Pi's isolated JSON stdout
channel binds every strict dispatch to its final-payload byte-bound estimate.
The durable task-run record retains observed input and delta when the provider
reports them, or an explicit telemetry-unavailable limitation while preserving
the verified conservative bound. Missing, malformed, conflicting, refused,
stale or nested model-authored admission evidence fails the strict run;
the budget ledger separately retains ordinary provider usage accounting. SC-05/AC-05
is Verified for the supported model-independent FSM and OpenAI Chat Completions
adapter. This does not claim exact tokenization, alternate-provider coverage,
configured local inference, model quality, savings or scale.
PLAN-165 closes the remaining SC-08 route safeguard boundary without adding a
permission subsystem. Current-agent provider admission receives an explicit
host-owned authority decision instead of assuming `allowed`; direct, current-
agent, isolated and replay dispatches re-evaluate the existing live budget
ledger, refuse hard limits before execution and retain accepted authority plus
budget evidence in the route admission. The coherent 32K/128K scenario now
covers denied authority and hard-budget refusal for all three routes. SC-08/AC-08
is Verified at the model-independent FSM boundary. Configured local inference
remains SC-09 and the installed Pi continuation-envelope limitation remains
SC-25; no model-quality or savings claim is made.
The first independent Terra/high review found valid host-authority, stale-budget
and durable-safeguard validation gaps. Test-first regressions now bind authority
to host preparation, repeat the budget decision inside the serialized execution
claim and fail closed on incomplete or mismatched safeguard evidence. The
first follow-up review also found two valid implicit-authority and durable
evidence-replacement gaps. Omitted authority now fails closed as `unknown`, the
direct host command carries the explicit decision, and current-agent
continuation compares durable safeguards with its trusted execution record.
The updated candidate passes build, 1,208 unit/component, 73 mock integration,
10 conformance/autopilot and 13 focused safeguard checks.
The next exact-head review found one valid cached-authority continuation gap.
The active host lifecycle now re-reads its mutable host-owned decision at every
provider admission, and an installed-host `allowed` then `denied` regression
proves the continuation aborts. This remains a minimal decision boundary, not a
permission service or approval workflow.
The fresh-context Terra/high review of implementation head `7e725f7` reports no
findings after checking the authority, budget and durable-evidence boundaries.
The final exact-head review also reported no findings. PR #32 merged with merge
commit `d555be8b2662548bd24356943d0b48e271d66bb9`; its reviewed head
`d9d19e3b0cfc63b53acf4528edce2f9492cd2055` passed build, 1,208
unit/component, 73 mock integration, 10 conformance/autopilot and 172 affected
route/host checks.
PLAN-166 then reassesses the remaining P3 matrix without adding code. The
model-independent P3 units are complete: SC-05/07/08 are Verified at their
documented boundaries. SC-04 remains Partial because risk-triggered direction
assessment depends on P4 intent/necessity contracts and belongs to P5. SC-09
configured local-only end-to-end evidence belongs to P7 and remains Not assessed.
SC-25 retains its documented incomplete actual-host execution coverage across
context accounting, usage, cancellation and supported child routes; the
continuation-envelope restriction is one concrete host limit, not the whole gap.
These honest cross-phase statuses do not reopen a reproduced model-independent
P3 adapter or context-access gap; the next implementation phase is P4.
PLAN-167 starts P4 with the smallest reproduced structural admission gap. The
shared execution-plan validator now rejects missing dependency IDs, self-cycles
and longer cycles before planning-report publication while retaining valid
forward-reference DAGs. Its candidate passes build, 1,210 unit/component, 73
mock integration, 10 conformance/autopilot and 25 focused plan checks. SC-03
remains Partial because links and acyclicity do not establish task necessity,
requested-scope completeness, progressive milestone readiness or the absence of
design-induced prerequisites.
PLAN-168 makes the existing two-way structural coverage diagnostics a true
admission guard. Planning reports now combine the current catalog with proposed
requirement IDs and reject uncovered requirements, unknown task refs and tasks
without requirement refs before requirement, plan, report or task publication.
A compact one-task/one-requirement plan remains valid. The candidate passes
build, 1,212 unit/component, 73 mock integration, 10 conformance/autopilot and
58 affected plan/policy checks. This still does not treat links as proof of
semantic necessity or requested-scope completeness.
PLAN-169 reuses the existing task-quality assessor as a read-only planning
preflight. The exact prospective task overlay must satisfy DoD, path scope,
atomicity and validation/test-first policy (or explicit waivers) before any
planning publication. Accepted replans share the coverage and contract preflights
before snapshot or active-plan writes, without rechecking existing tasks that their
application path leaves unchanged. Existing manifest inheritance is preserved. The
candidate passes build, 1,216 unit/component, 73 mock integration, 10
conformance/autopilot and 65 affected checks. This verifies contract admission,
not the semantic quality or necessity of model-proposed work.
PLAN-170 closes the smallest reproduced requirement-validity gap. A
user-authorized statement, source or acceptance-criteria amendment now marks only
that requirement's coverage `needs_replan` under the existing PRD lock while
preserving task links, evidence references, notes, immutable history and unrelated
coverage; amendments do not manufacture missing coverage rows. Title-only changes
preserve coverage but not the separate revision-bound receipt freshness. The
candidate passes build, 1,219 unit/component, 73 mock integration and 10
conformance/autopilot checks.
SC-06/12/27 remain Partial because this boundary neither selects affected tasks
nor infers semantic necessity or corrective work.
PLAN-171 connects that explicit invalidation to accepted replanning without a
new task lifecycle. A preservation-valid proposal must retain any validated task
explicitly linked to `needs_replan` coverage. Acceptance reopens only those task
ids to `ready`, removes only their current validated/completed membership,
retains unrelated validated work, advances the affected coverage to
`in_progress`, and records the reopened ids. Acceptance uses the existing
decision ledger as an `applying` journal so retries preserve the exact audit and
plan version. Coverage is reread and affected-only merged under the PRD lock;
captured requirement-revision drift fails closed without overwriting unrelated
invalidations. The journal also fingerprints the normalized full requirement
catalog and unaffected coverage rows; the final PRD-locked publication and an
accepted retry fail closed if either basis has changed. The model cannot use
this path to rewrite an exercised accepted contract. The candidate passes build, 1,223 unit/component, 73 mock integration,
10 conformance/autopilot and 52 focused plan/PRD checks. SC-12/27 remain Partial because automatic replan triggering, task
replacement/obsolescence and semantic affected-slice discovery are not provided.
PLAN-172 starts P5 with the smallest reproduced SC-15 boundary. `running`
heartbeats, including ordinary parent `turn_end` events, now preserve the last
evidenced-progress timestamp for their scope. A `progress` heartbeat is admitted
only with one allowed progress kind, a bounded non-empty evidence-reference set
and a concise summary; this structural record does not make the referenced claim
true outside its owning acceptance gate. Focused watchdog and extension
regressions cover repeated liveness, unsupported progress claims and valid
evidenced progress. Independent review then required invocation-specific scopes,
serialized atomic heartbeat publication, legacy evidence-free progress downgrade
and a trusted automatic publisher; supervisor-accepted task validation now emits
the first persisted `acceptance_check` progress record. SC-15 remains Partial:
other automatic progress publishers, aggregate tactic/review limits,
enclosing-run history across worker replacement/resumption and declared
long-running-operation allowances are not implemented by this unit.
PLAN-173 closes one narrow SC-11 admission bypass: `newEvidence` prose alone no
longer admits a repeated failed attempt or clears a fingerprint-cycle gate. The
attempt must also introduce a normalized `evidence`, `validationRun` or `logRefs`
identity not already recorded for the task. This remains structural admission;
the owning evidence gate decides whether the referenced claim is true. Review
closure also requires a strictly later persisted attempt, serializes concurrent
claims under a bounded non-stealing lock and rejects malformed legacy reference
values and containers without crashing. The gate tracks the latest unresolved
blocker, so evidence that cleared an earlier cycle cannot mask a later cycle.
SC-11
remains Partial because semantic rewording detection, aggregate tactic limits
across replacement/resumption and the full AC-11 bounded fixture remain open.
PR #24 merged as `232b3f2c9c5007833a8ee0ec7ca0ab171d7267b2` after an
independent GPT-5.6 Terra/high review of exact head `e3d849c` found no
unresolved in-scope findings. The primary exact-head gate passed build,
1,048 unit, 67 mock integration, 7 conformance and diff check. PLAN-154 then
closes the older zero-exit terminal failure gap in task conductor/debug retry
with shared outcome semantics; build, 1,163 unit, 68 mock integration,
7 conformance and 69 focused tests pass on its candidate tree. This does not
upgrade any full SC/AC row to Verified.

The earlier exact-head Copilot gate was superseded on 2026-09-27 by Nikola's
explicit Terra-agent replacement above. Preserve all branch protections and
use expected-head merge commits after a completed independent exact-head
review, primary review and the full applicable gate.

Continue coherent phase branches with separate logical commits, at most one PR
in review and one next unit in preparation. Claim a bounded continuation marker
after checking live agents, processes, worktrees and Git state; release it at
handoff. Report published commit links, actual checks, blockers and next steps
in Bulgarian on each scheduled run. Never imply continuous execution between
runs or manufacture commits for reports. The current review delegate is
GPT-5.6 Terra/high by Nikola's explicit replacement. Paid external model calls
and deployments remain out of scope.

## Architecture direction

The product objective is a durable, maintainable software project across later
initiatives, features, fixes and refactoring. Focused context, small steps,
state-specific prompts and the requirement/decision/evidence ledger make a
configured local model useful without relying on frontier-model behavior.
Small starting contexts must preserve on-demand access to all task-authorized
required information. Focus reduces distraction and fits the configured usable
window, including hardware-limited local profiles; it is not a reason to hide
necessary facts. Admission checks every added source and subsequent model call.
Confidentiality, data ownership, effect control and predictable operation can
exclude cloud inference entirely. Budget limits primarily prevent unauthorized
paid use or a stalled local run; they never justify skipping required context,
validation or history. Keep process correctness and model-specific task quality
as separate observations in P3 through P7.

Keep Pi as the first adapter and keep the sequential workspace policy. Evolve
existing modules instead of introducing a service cluster, event bus, agent
hierarchy or second framework. The supervisor owns admission and acceptance;
workers produce proposals tied to task/attempt/input identities. Persist state
through one transactional boundary; keep versioned artifacts and compact evidence
references outside model context. Tool/model/environment adapters supply optional
capabilities, not mandatory stages.

Separate deterministic invariants (identity, versions, budgets, permission checks)
from evidence-backed semantic assessments (intent, necessity, correctness). A
schema-valid report or another model's agreement cannot establish the latter.
Compatibility adapters must not preserve a bypass simply to keep a test green.

## Ordered delivery roadmap

| Phase | Work and requirement coverage | Depends on | Acceptance / release boundary |
|---|---|---|---|
| P1 | Repair state read/write behavior, preparation/worker handoff, process termination and actual Pi tool API ownership. SC-13/15/22/25 foundations. | Baseline + this plan | Regression fixtures for each reproduced defect; build and impacted integration checks. Does not certify full SC requirements. |
| P2 | Shared admission/acceptance for every report/command/hook; task and attempt IDs; input/output/validation-policy fingerprints; reject stale/empty evidence, protect criteria, check integration and current requirements. Add revision-checked state writes and explicit interrupted-attempt recovery. SC-01/02/10/13/26. | P1 | AC-01/02/10/13/26 across public routes, including false-success and stale-writer failure injection. Legacy accepted labels never migrate as fresh evidence. |
| P3 | Enforce full model-request admission including actual host/tool content and output reserve; exact section retrieval and on-demand required-information access; effective shrink/split; three per-request routes and eligible local profiles. Admit model-proposed scoped context and route under the current state contract; P4 owns full plan necessity and decomposition checks. SC-04/05/07/08/09/25. | P2 contracts | AC-04/05/07/08/09/25; no oversized request dispatched, no necessary facts silently withheld, no silent cloud fallback, real installed host API checks; valid proposals advance and invalid proposals fail closed regardless of model quality. |
| P4 | Minimal and progressive planning; versioned original user intent, assumptions and constraints; two-way coverage/necessity; valid dependency frontier; affected-only replanning and provenance invalidation. SC-02/03/06/12/27. | P2 contracts, P3 context | AC-02/03/06/12/27 including CSV scope-creep, necessary-prerequisite and correct-minimal-plan controls. |
| P5 | Evidence-led diagnostic attempts, aggregate retry/tactic/review limits, genuine progress detection and risk-triggered independent assessment. Version-aware bounded research. SC-04/06/10/11/15/21. | P3/P4 | AC-04/06/10/11/15/21 with reworded repeats, agent replacement, reviewer-created requirements and evidence-resolved disagreement. |
| P6 | Scoped authority through all routes; uncertain effect reconciliation; compact Git/evidence history; reference-aware retention; optional environment capability/lifecycle. SC-14/16/17/18/19/20/22. | P2 authority, P3 adapters | AC-14/16/17/18/19/20/22 with interruption, denied actions, secret redaction, unrelated changes and unavailable providers. |
| P7 | Supported local-only end-to-end process profile; bounded large-run fixtures; separate task-specific model-quality/cost observations from process correctness; current SC conformance gate and usable documentation. SC-09/23/24/26 and all integration criteria. | P2–P6 | All applicable process AC scenarios with named implementation, host/model, fixtures, resource limits, state transitions and retained evidence. Unavailable profiles remain blocked/Not assessed; a model's completion rate is not a process acceptance gate. |

Before starting each phase, refine only its next executable units and record
concrete fixture inputs, limits, expected observations and validation commands.
Preserve valid prior results. Any changed requirement or failed assumption reopens
affected acceptance. No whole-product rewrite or speculative provider work.

## P1 executable units and commit boundaries

| Unit | Change / why needed | Focused validation | Status |
|---|---|---|---|
| P1.1 | Read existing state without rewriting; publish complete JSON atomically; initialization must not replace an existing run. | `test/state.test.ts`: stable bytes/mtime, concurrent initializers, invalid JSON, failed publication/reader visibility. | Implemented; focused checks pass |
| P1.2 | Preparation cannot mark a task running; account/admit before dispatch; reload worker-persisted state before usage/handoff instead of overwriting it. | `test/conductor.test.ts`: prepare then execute, refused admission, persisted child updates and changed-run rejection. | Implemented; focused checks pass |
| P1.3 | Escalate timeout/abort based on actual exit; signal termination is a failed run; remove timers/listeners and report cleanup accurately. | `test/subagents.test.ts`: real TERM-ignoring child, timeout, abort, natural completion and spawn failure. | Implemented; focused checks pass |
| P1.4 | Use Pi ExtensionAPI for tool discovery/focus/restore; mocks must place methods on their actual owner; preserve child tool selection. | `test/extension-shape.test.ts`, installed host types, real Pi catalog command, TypeScript build. | Implemented; focused checks pass |

These are prerequisites, not the full recovery or authority implementation. Atomic
replacement alone does not prevent lost updates. P2 must add revision checks and
migrate every mutation path before claiming SC-13. P1.2 addresses the task
conductor only; audit all other child execution paths in P2. P1.3 initially covers
the directly owned process; descendant containment belongs to P6's provider work.

## P2 executable units

P1 merged in PR #2 as `90f347852b758ecb56168dafc6068f2480aef7f7`.
Deliver P2 through bounded PRs; none alone establishes SC-13 or full acceptance.

| Unit | Change | Acceptance boundary | Status |
|---|---|---|---|
| P2.1 | Serialize state publication across processes and compare run identity/revision before replacement. Preserve read-only legacy loading. | Stale writers and concurrent writers cannot lose committed updates; missing/malformed state and held publication locks fail safely. Build and unit/mock integration gate. | Implemented; gate passed, separate ledger flake recorded below |
| P2.2 | Persist attempt identity and input/output/policy fingerprints; reconcile interrupted attempts. | Reject replaced attempts and stale output after restart without replaying uncertain effects. | Merged PR #5 after completed Copilot review; boundary and limitations in PLAN-101 |
| P2.3 | Route reports, commands, hooks and validation through shared version-bound acceptance. | Current independent evidence and integration criteria required; legacy accepted labels are not fresh proof. | In progress: PLAN-102 / PR #6 and PLAN-103 / PR #7 merged; PLAN-104 shares automatic receipt checks; PLAN-105 makes manual positive claims proposal-only. Independent non-software acceptance, aggregate completion and universal authority remain open |

Mutation inventory for P2.1: all production `state.json` publications are in
`src/state.ts`. Callers are `autopilot`, `budgets`, `checkpoints`, `conductor`,
`debug-retry`, `index` commands/hooks, `missing-context`, `operations`, `replanning`,
`reports`, `stage-advancement`, `stage-workflow`, `tasks`, `validation`, and
`watchdogs`. Derived snapshots must carry the revision they read, and successful
saves must propagate the committed revision before the next write. Conflicts are
explicit failures, not automatic retries of actions or merges of stale objects.
The state publication lock is distinct from the longer execution lock so worker
usage hooks can save while their parent waits. No time-based lock stealing.

Other JSON ledgers, multi-file atomicity, process authority and semantic evidence
acceptance remain P2.2/P2.3/P6 work; a state revision does not solve them.
Fixtures: two copies of one revision, two OS processes released from a common
barrier, a deleted state file, legacy/malformed revision metadata, and an existing
publication lock. Focused command: `node --test --import tsx test/state.test.ts`;
final gate: `npm run build` and `npm test`.

### P2.1 validation record and handoff

- Four new regressions failed on P1: stale overwrite, both independent processes
  accepting the same base, recreation of deleted state, and silent run replacement.
  All now pass. Seven added tests also cover logical legacy revision migration,
  invalid revision preservation, and bounded contention without age-based stealing.
- `npm run build` passed. Final `npm test` passed 508/508 unit/component tests
  and 67/67 mock integrations. `git diff --check` passed.
- Pi 0.85.1 with `opencode-free-test/big-pickle` passed the existing synthetic
  task-report/validation-handoff contract 1/1 (about 14 seconds, 45-second limit).
  This checks actual subprocess/report compatibility, not end-to-end quality.
- Fixture changes preserve existing assertions: subsequent actions use the last
  committed snapshot instead of a fresh run or stale pre-action state; the
  replaced-run test now injects an external file replacement explicitly because
  `saveState` correctly refuses it. The Git fixture creates valid state directly
  instead of first writing an incomplete `{}` placeholder.
- A preliminary mock run observed `Unexpected end of JSON input` in
  `loadToolResults` during the parallel tool-schedule test. The ledger code is
  unchanged here. Six bounded isolated checks on merged P1 passed, and the final
  changed-branch gate passed, so baseline reproducibility is not established.
  Do not interpret the final green run as fixing this race risk. Parallel tool
  ledger read/modify/write serialization remains an explicit follow-up.
- P2.2 next: inventory durable attempt/evidence records, include the tool-ledger
  race above, then bind attempt IDs to input/output/policy versions and define
  interruption reconciliation. State conflicts fail explicitly; no automatic
  action replay, stale merge, or multi-file transaction is introduced in P2.1.

## Working and verification process

PLAN-106 continues P2.3 with completion provenance shared by autopilot, stage
conductor/workflow and execution artifact advancement. Build, 615 unit and 67
mock integration tests pass. Historical labels alone cannot complete a run;
postcommit artifact freshness and integrated current-output acceptance remain
open. See PLAN-106 for the exact proof boundary and next unit.

PLAN-107 extends this to accepted Git output integrity: actual commit/path
identity and ancestry, current bytes/modes/deletions and index checks. Build,
629 unit and 67 mock integration tests pass. Skip/non-Git artifact freshness,
unrelated outputs and final semantic/integration acceptance are still open.

PLAN-108 guards the direct Git decision API with full current receipts. PLAN-109
then closes Git index-flag and index-only omissions in candidate identity; its
gate passes build, 649 unit and 67 mock integration tests. None of these units
establishes universal output/semantic acceptance or full P2.3 completion.

PLAN-110 binds explicitly declared filesystem outputs independently of Git at
