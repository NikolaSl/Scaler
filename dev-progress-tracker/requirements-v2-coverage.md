# Revision 2 Coverage Assessment

Reviewed code: d866b6957d0b79b455875e56b635ff8f774d0129.
Assessment date: 2026-09-16. Requirements-only change; no implementation fix is claimed.

This is the CURRENT assessment for SC-* requirements. The legacy
[traceability matrix](traceability-matrix.md), [gap backlog](gap-backlog.md) and
implementation inventory remain historical evidence for PRD-* requirements.
Failed means a counterexample was identified for a mandatory behavior. Partial
means related implementation exists but full revised behavior is not verified.
Not assessed means this review did not establish the acceptance result.
No row is Verified in this requirements revision.

Prior review ran the baseline TypeScript build successfully, 488/488 unit tests
and 66/67 mock integration tests. The failed retention fixture uses fixed
December 2025 dates with a 200-day threshold and depends on the wall clock.
Those results do not verify revision 2, a local model, or the real host end to end.

| Requirement | Status | Assessment | Existing evidence location | Acceptance |
|---|---|---|---|---|
| SC-01 | Failed | QA/report bypass reproduced in reviewed baseline; shared acceptance guards not established. | `src/validation.ts`, `src/reports.ts` | [AC-01](../specs/acceptance-scenarios.md#ac-01) |
| SC-02 | Partial | Task fields/report contracts exist; complete versioned attempt/executor contract not established. | `src/types.ts`, `src/tasks.ts`, `src/task-reports.ts` | [AC-02](../specs/acceptance-scenarios.md#ac-02) |
| SC-03 | Partial | Dependencies and plans exist; minimal/incremental planning and all admission guards need scenario coverage. | `src/plans.ts`, `src/conductor.ts` | [AC-03](../specs/acceptance-scenarios.md#ac-03) |
| SC-04 | Failed | English keyword classifier routes 'What is Docker?' to level 4 and a complex Bulgarian request to level 1. | `src/adaptive.ts` | [AC-04](../specs/acceptance-scenarios.md#ac-04) |
| SC-05 | Failed | Required context bypass and unchanged oversized dispatch prompt reproduced. | `src/context.ts`, `src/conductor.ts` | [AC-05](../specs/acceptance-scenarios.md#ac-05) |
| SC-06 | Partial | Validity labels and memory references exist; dependency-based freshness and invalidation unverified. | `src/memory.ts`, `src/context.ts` | [AC-06](../specs/acceptance-scenarios.md#ac-06) |
| SC-07 | Partial | Retrieval exists; file section scope uses prefix truncation rather than the requested section. | `src/context.ts` | [AC-07](../specs/acceptance-scenarios.md#ac-07) |
| SC-08 | Partial | Isolated tools and catalogs exist; measured per-request three-mode policy not established; active-tool API mismatch found. | `src/tool-requests.ts`, `src/index.ts` | [AC-08](../specs/acceptance-scenarios.md#ac-08) |
| SC-09 | Not assessed | Model option exists; local-only envelope and end-to-end acceptance not demonstrated in this review. | `src/subagents.ts` | [AC-09](../specs/acceptance-scenarios.md#ac-09) |
| SC-10 | Failed | Accepted status can be obtained without validation runs; evidence/version acceptance needs repair. | `src/validation.ts`, `src/tools.ts` | [AC-10](../specs/acceptance-scenarios.md#ac-10) |
| SC-11 | Partial | Failure/attempt ledgers exist; revised combined retry/effect/validation criteria need verification. | `src/debug.ts`, `src/debug-retry.ts` | [AC-11](../specs/acceptance-scenarios.md#ac-11) |
| SC-12 | Partial | Plan preservation exists; validity-aware obsolescence/correction needs revised scenarios. | `src/plans.ts`, `src/replan-agent.ts` | [AC-12](../specs/acceptance-scenarios.md#ac-12) |
| SC-13 | Failed | Parent overwrote simulated child changes; prepare persisted running without a worker. | `src/state.ts`, `src/conductor.ts` | [AC-13](../specs/acceptance-scenarios.md#ac-13) |
| SC-14 | Not assessed | End-to-end uncertain external outcome reconciliation not demonstrated. | `src/tool-requests.ts`, `src/git.ts` | [AC-14](../specs/acceptance-scenarios.md#ac-14) |
| SC-15 | Partial | Counters/watchdogs exist; termination uses child.killed as if it meant process exit; full reservations/accounting unverified. | `src/budgets.ts`, `src/subagents.ts` | [AC-15](../specs/acceptance-scenarios.md#ac-15) |
| SC-16 | Partial | Safety policies/hooks exist; actual containment and all-route authority require revised acceptance evidence. | `src/safety.ts`, `src/index.ts` | [AC-16](../specs/acceptance-scenarios.md#ac-16) |
| SC-17 | Partial | Structured logs exist; coherent revision/attempt reconstruction and privacy envelope need verification. | `src/logging.ts` | [AC-17](../specs/acceptance-scenarios.md#ac-17) |
| SC-18 | Partial | Task commits exist; compact durable audit publication and crash reconciliation need verification. | `src/git.ts` | [AC-18](../specs/acceptance-scenarios.md#ac-18) |
| SC-19 | Partial | Storage maintenance exists; retention of referenced acceptance evidence needs revised scenarios. | `src/storage.ts` | [AC-19](../specs/acceptance-scenarios.md#ac-19) |
| SC-20 | Partial | Specific environment helpers exist; product-neutral capability/lifecycle criteria not demonstrated. | `src/cicd-environments.ts`, `src/validation-environments.ts` | [AC-20](../specs/acceptance-scenarios.md#ac-20) |
| SC-21 | Partial | Research reports and quality metadata exist; evidence/stopping scenarios remain to be executed. | `src/research.ts`, `src/research-agent.ts` | [AC-21](../specs/acceptance-scenarios.md#ac-21) |
| SC-22 | Partial | Sequential lock exists; all-entry-point ownership and interrupted-worker reconciliation require verification. | `src/locks.ts`, `src/operations.ts` | [AC-22](../specs/acceptance-scenarios.md#ac-22) |
| SC-23 | Not assessed | No declared large-run envelope or scale result established in this review. | `src/context.ts`, `src/storage.ts` | [AC-23](../specs/acceptance-scenarios.md#ac-23) |
| SC-24 | Partial | Tests and usage reports exist; representative outcome evaluation and revision 2 coverage gate are pending. | `src/provider-usage.ts`, `src/conformance.ts` | [AC-24](../specs/acceptance-scenarios.md#ac-24) |
| SC-25 | Failed | Tool focus reads methods from ctx although reviewed Pi exposes them on ExtensionAPI; permissive mock masks this. | `src/index.ts`, `test/extension-shape.test.ts` | [AC-25](../specs/acceptance-scenarios.md#ac-25) |
| SC-26 | Partial | Automation loop exists; revised complete-run, cancellation and recovery guarantees not demonstrated. | `src/autopilot.ts` | [AC-26](../specs/acceptance-scenarios.md#ac-26) |
| SC-27 | Partial | Requirement versions/links exist; task status alone is insufficient proof of current requirement acceptance. | `src/prd.ts` | [AC-27](../specs/acceptance-scenarios.md#ac-27) |

## Implementation progress — PLAN-099

P2.1 follows merged P1 (`90f3478`). `saveState` now compares run identity and
revision under a short cross-process publication lock. Stale snapshots and
deleted-state recreation are rejected; successful saves advance persistence
metadata. Legacy files load without rewriting bytes or inventing evidence.
An interrupted lock fails closed and requires reconciliation before removal.
Final validation: build, 508/508 unit tests, 67/67 mock integrations and one real
Pi 0.85.1/Big Pickle synthetic report-to-validation-handoff contract passed.
This is partial SC-13 evidence only. Attempt-bound acceptance, multi-file ledgers,
authority and interruption recovery are still open. A preliminary parallel-tool
ledger parse failure is recorded in PLAN-099; subsequent green checks do not
establish that the ledger race is fixed.

PLAN-100 subsequently reproduces that execution-ledger defect: parallel writers
lose records and readers observe partial JSON. Requests/results/transactions now
serialize complete read/modify/write operations across processes and publish
complete snapshots. Six new synthetic regressions cover parallel identity
retention, reader visibility, independent workers, serialization failure,
held-lock refusal and post-commit cleanup failure. Build, 514/514 unit tests and
67/67 mock integrations pass. A cleanup failure cannot relabel an already
committed tool result as failed; it emits a warning and leaves subsequent writers
fail-closed for reconciliation.
This is not a multi-file transaction, effect reconciliation or acceptance gate;
other catalog ledgers remain outside this bounded change.

PLAN-101 / PR #5 adds execution-lock-owned task attempts to conductor and debug
retry: immutable run/task/input/route/policy bindings, report output digests,
fail-closed interrupted-attempt recovery and validation freshness guards. A
separate post-worker context snapshot prevents later declared-source changes
from silently reusing completed evidence. Synthetic regressions cover stale
reports, changed task/policy/context, changes during validation, retry identity,
budget refusal and interruption publication failure. Build, 543/543 unit tests
and 67/67 mock integrations pass; live-provider tests were not run for this unit.
Review is pending. These are partial SC-02/11/13/17/22 results, not closure:
manual/unbound acceptance, commit/hooks, artifact correctness and a universal
acceptance authority remain P2.3. See PLAN-101 for the exact freshness scope.

PR #5 subsequently merged after completed Copilot review on `d1628a2` with no
specific findings. PLAN-102 / PR #6 begins P2.3 with one shared validation-receipt
verifier for direct and locked commit/skip routes. Task labels and historical
passing records no longer authorize these operations. Receipts bind current
run/task/attempt/policy/context, command results and Git candidate bytes/HEAD;
validation also rejects candidate changes during checks. Ten regressions failed
before the implementation. Build, 29/29 focused checks, 560/560 unit tests and
67/67 mock integrations pass. PR #6 review is pending. Manual report/checklist,
automatic acceptance, integration semantics, non-Git outputs and tamper-resistant
worker authority remain open; this is partial SC-01/10/13 evidence only.
Self-review then reproduced and fixed a rename/copy candidate-digest collision;
symlink-ancestor reads are refused. Corrected gate: build, 19/19 acceptance
regressions, 562/562 unit and 67/67 mock integrations. Final-head review is required.
Two valid Copilot findings were then reproduced by four failing tests: snapshot
errors now return commit/skip refusal or persist blocked validation with executed
check evidence retained. Corrected gate: build, 23/23 acceptance, 566/566 unit,
67/67 mock integration tests. Re-review remains required before merge.
The subsequent review's buffering concern is addressed with incremental streamed
file hashing plus a multi-chunk binary fixture; its misleading-comment note is
corrected. Gate: build, 24/24 acceptance, 567/567 unit and 67/67 mock integration.
No measured scale-envelope or memory-saving claim is implied.
Skip-evidence consistency is also checked independently of its digest: stored
reason/disposition must match the authorized policy. A malformed-producer
regression and a positive skip fixture pass; simple tampering was already rejected.
Gate: build, 26/26 acceptance, 569/569 unit and 67/67 mock integrations.

PR #6 merged after completed final-head Copilot review. PLAN-103 then closes
generic proposal acceptance: report ingestion refuses validated/completed
transitions, task creation/update cannot grant validated status, and metadata
updates cannot rewrite an already validated task. Nine new regressions failed
before the fix, alongside a passing ordinary-proposal control. Refusals retain
audit records without replacing task contracts or validation policies. All 57
focused checks pass; dedicated receipt-backed commit/skip remain covered. This
does not close SC-01/10/26: manual validation/checklist authority, automatic
acceptance, postcommit identity and aggregate completion still require work.
PLAN-103 gate: build, 579/579 unit, 67/67 mock integration; review pending.

PR #7 subsequently merged after completed final-head review recommending
approval, with no findings. PLAN-104 reuses the same receipt verifier before
automatic task validation publishes Git acceptance. Empty checks, optional-only
failures and stale state no longer produce accepted skips/validated tasks.
Five pre-fix failures, four positive controls and one task-identity test cover
this boundary. Build, 46/46 focused, 589/589 unit and 67/67 mock integration pass.
No third candidate hash is added to a passing validation. Review is pending;
manual reports/checklists, raw Git-decision helper, postcommit identity and
aggregate completion remain open. SC-01/10/26 are not declared compliant.

PLAN-105 makes manual positive validation/report/checklist claims proposal-only.
Eight regressions (including actual registered tool execution) failed before the
fix. Caller-supplied passed/not-applicable or evidence refs no longer promote a
task. Checklist claims and failure/blocking diagnostics remain recorded; normal
tool-call budget accounting is preserved. Supervisor command validation applies
positive outcomes privately after receipt/Git checks. Build, 597/597 unit and
67/67 mock integration pass; completed final-head review remains required.
Independent non-software acceptance is explicitly unavailable until an appropriate
verifier exists; no dummy-command or mandatory-second-model workaround is added.
Full SC-01/10/26 coverage, postcommit identity and aggregate completion remain open.

Implementation has now started on merged baseline `8f4cf19`, following
[PLAN-099](../plans/implementation-plan-099.md). The original assessment table
above is retained as the reviewed baseline. P1.1 adds read-only existing-state
lookup, atomic snapshot replacement and exclusive initialization; 15 focused
state/checkpoint tests and the build pass. This is partial SC-13 evidence, not
closure of the lost-update, stale-proposal or interruption requirements.

P1.2 adds task-conductor preparation/dispatch separation and reloads persisted
worker state before accounting/handoff. Its 27 focused conductor/autopilot tests
cover preparation followed by execution, refused spawn accounting, child updates
and rejection after run replacement. General revision checks and other worker
paths remain unverified. SC-13 remains open.

P1.3 replaces the `child.killed` exit assumption with observed process exit,
enforces non-success outcomes for timeout/abort, and cleans cancellation handlers.
Subagent/watchdog tests pass 20/20, including a real TERM-resistant POSIX child.
This addresses the observed direct-process defect in SC-15; aggregate budgets,
descendant containment and semantic progress detection remain open.

P1.4 corrects tool discovery/focus/restore to use Pi ExtensionAPI and keeps child
tool selection separate from parent focus. The combined extension/subagent checks
pass 29/29, and the actual installed Pi catalog-command check passes 1/1 without
a model request. This resolves the API-owner counterexample in SC-25; full host
context accounting, isolation and model execution remain unverified.

The complete P1 regression gate passes: build, 501 unit tests and 67 mocked
integration tests. The real-host check used Pi 0.80.3. Model-driven verification
remains blocked by the environment authentication network policy; no model
request was made. See PLAN-099 for the exact boundary and next P2 handoff.

## Second-iteration assessment boundary

The second requirements iteration changes no implementation. Existing Failed and
Partial findings above remain applicable; none is upgraded by adding prose or
acceptance scenarios. The following refinements are **Not assessed** within those
aggregate rows and require the extended AC scenarios before any Verified claim:

- SC-02/03/12/27: original intent versus interpretations, task necessity at every
  decomposition/replan, necessary prerequisites versus invented scope, and
  reviewer-originated requirements.
- SC-04/09/10: risk-triggered direction checks, independent reviewer preparation,
  bounded evidence-based disagreement, local eligibility and validation integrity.
- SC-06/11/15: assumption status and failed-approach handoffs, discriminating
  diagnosis, enforced tactic changes/stopping and aggregate progress limits.
- SC-21/24: evidence for actual API capabilities, bounded repetitive research and
  evaluation with planted errors, correct controls, false alarms and total cost.

Copilot's index and wording corrections improve document consistency only; they
do not close runtime findings. No real-model reviewer evaluation was run here.

## Next-phase assessment backlog

1. Consolidate authority, state ownership and output-bound acceptance (SC-01/10/13).
2. Implement actual context admission and host tool control (SC-05/07/25).
3. Specify minimal contracts, routing profiles and local capability envelope (SC-02/04/08/09).
4. Reconcile effects, process termination, budgets and durable history (SC-14/15/17/18).
5. Add validity-aware requirement, memory and plan updates (SC-06/12/27).
6. Verify scope necessity, evidence-led tactic changes and proportional independent
   assessment, including rejection of reviewer-created scope (SC-03/04/10/11/15/27).
7. Exercise complete workflows, optional environment providers and declared scale
   fixtures with honest measured outcomes (SC-20/23/24/26).

This is an assessment queue, not an approved component architecture or code plan.
Implementing one item must not silently weaken another core guarantee.

The current src/conformance.ts recognizes legacy PRD-* IDs and does not validate
SC-* coverage or these acceptance scenarios. Its existing passing test is historical
compatibility only. Updating that gate belongs to the later implementation phase;
revision 2 document integrity is checked separately during this change.
# PLAN-106 continuation

Completion now requires matching current-run validation provenance and Git
commit/skip evidence via `src/run-completion.ts`, including loaded completed
states in autopilot/stage-conductor/stage-workflow and execution artifacts.
`test/completion-provenance.test.ts` includes real sequential commits and
non-Git skip controls. Historical HEAD equality is deliberately not required;
accepted artifact freshness and final integration remain open. SC-01/10/26
and P2.3 remain incomplete; this entry does not upgrade their overall status.
