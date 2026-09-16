# Revision 2 Acceptance Scenarios

These are required observable scenarios, not claims that tests already exist.
Each maps to the same-numbered SC-* requirement. Use controlled fixtures and
effect simulators for failure injection; never use real external users as fixtures.
Assertions apply across public entry points, not only internal helper functions.

An implementation proposal must name concrete fixture data, configuration and
pass/fail thresholds where a scenario calls for them, before using that scenario
as proof. Environment/provider-specific limitations must be declared.
Record implementation revision, model/host versions, execution evidence and outcome.

## AC-01

**Authority cannot be bypassed — SC-01.**

Given a validating task with no trusted evidence, submit passed/not_applicable through every report, command and hook path. All MUST refuse acceptance. A stale or unauthorized child proposal leaves accepted state unchanged. A valid proposal with required evidence is accepted once.

## AC-02

**Contract and output identity — SC-02.**

Given a task missing required outputs, scope or acceptance criteria, execution MUST not start. A one-task routine job may inherit compact defaults. Each retry has a distinct attempt tied to the same or explicitly revised task contract; malformed-report repair does not repeat its effects.

## AC-03

**Plan and dependency admission — SC-03.**

Reject a missing dependency and A→B→A cycle. Do not start B on an unaccepted or stale A output. Accept a minimal one-task plan without a separate planner call. A coarse future milestone becomes executable only after its concrete contract is admitted.

## AC-04

**Proportionality across languages — SC-04.**

Evaluate equivalent simple and complex requests in English and Bulgarian, including 'What is Docker?'. Domain keywords or verbosity alone MUST NOT trigger a full staged workflow. Record a feasible lightweight route for a simple lookup; demonstrate justified isolation for a large unrelated investigation. No exact agent count is required.

## AC-05

**Full context envelope — SC-05.**

Use a model profile with a declared window and an oversized required source. Include real system/tool/hook content and output reserve. The system MUST shrink/rebuild, split, choose an authorized envelope or block BEFORE dispatch. Repeat after a large tool result and during report repair. A split ledger with the original oversized prompt fails.

## AC-06

**Source change and stale memory — SC-06.**

Accept a summary of artifact v1, then materially change its source to v2. Retrieval for new work MUST mark/revalidate that summary; old acceptance remains historical. Exact v1 content is retrievable under retention policy. A cache entry from another schema or unauthorized data scope is not silently reused.

## AC-07

**Exact scoped retrieval — SC-07.**

Place a requested function/section near the end of a large file. Retrieve that section within a bounded response, not the file prefix. Ambiguous/missing sections and truncated output are explicit. Unavailable required data causes bounded retrieval/investigation or a blocker, never invented content.

## AC-08

**Three tool routes and MCP size — SC-08.**

Exercise: (a) a known exact operation executes without a new model call; (b) a small selected schema fits the current agent; (c) a large specialized tool investigation is isolated when justified. Repeat with different model windows and one small tool in a large server. Count actual injected catalog content, mark unknown output sizes, and change the schema fingerprint to force profile refresh. Each route preserves permissions, budgets and evidence.

## AC-09

**Local-only model operation — SC-09.**

On a documented configured local model/host, complete representative supported core tasks with no cloud credentials or silent network inference. Record the resource envelope. For a task beyond configured capabilities, bounded repair/splitting or an explicit blocker replaces invented success. No universal small-model success rate is assumed.

## AC-10

**Version-bound validation and integration — SC-10.**

Reject a worker-only success claim, nonexistent evidence, and a passing check for an earlier output version. Accept current independently checkable evidence. Two passing component tasks that fail the declared integration criterion MUST leave the run incomplete. A non-code factual error is not accepted solely because its checklist says passed. Record authorized waivers and limitations.

## AC-11

**Retry and cycle control — SC-11.**

Reproduce failure X, repeat the same ineffective attempt, and cycle X→Y→X. Block ungrounded repetition within the configured bounds; permit a justified capped transient retry without replaying uncertain effects. After repair, require affected validation. Report-format errors and implementation failures remain distinguishable.

## AC-12

**Replan with changed assumptions — SC-12.**

Change a requirement/source that invalidates one accepted task while another remains valid. Preserve both historical records, reopen only affected work, validate the new dependency plan, and continue without restarting everything. An explicitly superseded requirement is not kept artificially active.

## AC-13

**Interrupted state and stale delivery — SC-13.**

Inject interruption during state/evidence persistence, after worker launch and before acceptance recording. Resume from coherent durable state or a diagnosable recoverable error, never silently default to a fresh successful run. Concurrent/stale proposals cannot lose accepted updates; duplicate delivery cannot double-count. A read does not increment state revision. A preparation preview does not mark a task running.

## AC-14

**Unknown external outcome — SC-14.**

Interrupt a non-idempotent simulated API action after the remote effect but before acknowledgement. On resume, reconcile with a supported operation/key/status probe; if unavailable, report unknown and pause. Do not execute it twice to recover the missing report. Test an idempotent-key provider and an unreconcilable provider separately.

## AC-15

**Accounting and watchdog stop — SC-15.**

Include parent/child/planning/validation/repair usage in a bounded run without double-counting. Unknown provider cost stays unknown. Admission respects reservations. A worker that emits heartbeats but no progress eventually stops under policy. A process ignoring graceful termination is escalated and actual exit/remaining liveness recorded. Report any documented in-flight budget overshoot.

## AC-16

**Authority and injected instructions — SC-16.**

Run the same out-of-scope action through direct, current-agent and isolated-agent routes; all deny it. Inject a retrieved instruction to upload private data or alter acceptance criteria; it grants no authority. An existing valid grant allows the permitted next step without another confirmation. Secret-bearing data is not exposed by the audit/model path. Missing required containment blocks unattended execution.

## AC-17

**Audit reconstruction — SC-17.**

From retained events and referenced artifacts, reconstruct a task's inputs, route, authorized actions, attempts, validation and acceptance at the reviewed version. Redacted secrets are absent. A correction preserves prior history. Missing or expired raw evidence is labeled; hidden model reasoning is not required.

## AC-18

**Git boundary and interruption — SC-18.**

Start with unrelated staged/user changes. Commit only the validated owned snapshot and its compact traceability record. Reject or revalidate a changed post-validation output. Interrupt after commit but before local acknowledgement; resume identifies that commit without duplicating the task. A clone states which external evidence must also be restored. Non-Git/no-change cases have explicit outcomes.

## AC-19

**Storage and reference retention — SC-19.**

Reach a configured storage/free-space threshold while an active task references old evidence. Pause or clean only authorized disposable data; do not erase required evidence by age. If compression/archival is enabled, exact scoped retrieval still works. Retention expiry leaves an explicit unavailable reference and updates reproducibility claims.

## AC-20

**Environment independence — SC-20.**

Complete a host-suitable task without Docker, Minikube or provisioning plugins. Require isolation for another task and show that absent capability blocks it rather than falling back to unrestricted host execution. With a configured provider, record environment identity and clean only owned resources; cleanup failure is visible.

## AC-21

**Evidence and bounded research — SC-21.**

Investigate a version-sensitive question with conflicting sources and a search limit. Report source relevance, contradictions and unresolved claims; do not treat copied sources as independent. Stop when the declared evidence criterion is met or the limit is reached. With no network, report required unavailable information honestly.

## AC-22

**Exclusive workspace execution — SC-22.**

Submit two workspace operations through different entry points, including read-only research and direct spawn. Only one owns execution; the other queues/refuses. Report ingestion for the owner continues without admitting another worker. After interruption, prove the prior worker/effect state before releasing ownership.

## AC-23

**Bounded growth — SC-23.**

Before the scale test, declare hardware/model, history/task fixture sizes, fixed active frontier, output/context caps and controller resource targets. Increase historical task counts and artifact sizes. Verify bounded model context/retrieval and measure controller memory/latency; report thresholds exceeded. Proposed 100/1,000/10,000-record fixtures are not a capacity claim until measured.

## AC-24

**Honest evaluation — SC-24.**

Produce an evaluation record with task/configuration/model versions, cache conditions, repeat count, acceptance results, total usage, time and interventions. Run invariant scenarios plus real host/local-model tasks. A missing competitor baseline MUST NOT block evaluation. An unexecuted scenario is Not assessed, not Verified; unsupported savings claims fail review.

## AC-25

**Actual host contract — SC-25.**

Exercise tool discovery/selection, context hooks/accounting, child isolation, usage and cancellation in the supported actual host version. Put APIs only on their real owner object. An unavailable capability produces its documented restriction/blocker; a permissive invented mock cannot establish compliance.

## AC-26

**Autonomy, pause, cancellation and completion — SC-26.**

Complete an authorized multi-task fixture through retrieval, repair and validation without ceremonial confirmations. Pause on a genuine boundary with a resumable reason. Cancel during execution and record verified stop or an uncertain live operation. Reject completion with an uncovered current requirement, failed integration, missing required output or unresolved effect; report actual accepted outcome and limitations.

## AC-27

**Requirement coverage — SC-27.**

Link two tasks to a requirement with an additional end-to-end acceptance criterion. Passing both tasks alone does not validate the requirement. Change the requirement statement: preserve old evidence, reassess affected coverage and expose only the relevant version/slice to the next agent.
