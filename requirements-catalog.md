# SCALER Requirements Catalog — Revision 2

Proposed normative baseline. See [assignment](assignement.md) for scope and authority.
SC-* IDs are stable; retired PRD-* IDs retain their historical meaning.
Core requirements apply to all runs with proportional record size. Conditional
requirements apply when their capability is used; a missing required capability
blocks the affected task. None of these rows asserts current implementation.

| ID | Requirement | Obligation | Acceptance | Behavioral detail |
|---|---|---|---|---|
| SC-01 | Authoritative control: All accepted progress uses common guards; agents cannot self-approve. | Core | [AC-01](specs/acceptance-scenarios.md#ac-01) | [supervisor](specs/supervisor.md) |
| SC-02 | Task and attempt contracts: Define inputs, authorized purpose, scope, assumptions, outputs, permissions, budget and acceptance. | Core | [AC-02](specs/acceptance-scenarios.md#ac-02) | [task-agents](specs/task-agents.md) |
| SC-03 | Planning and dependencies: Plan before effects; check coverage and task necessity at every decomposition, reject invented scope and validate dependencies. | Core | [AC-03](specs/acceptance-scenarios.md#ac-03) | [replanning](specs/replanning.md) |
| SC-04 | Proportional orchestration: Choose a feasible lightweight route and risk-triggered direction checks without mandatory extra agents. | Core | [AC-04](specs/acceptance-scenarios.md#ac-04) | [adaptive-orchestration](specs/adaptive-orchestration.md) |
| SC-05 | Context admission: Bound the full request and output reserve before every model call. | Core | [AC-05](specs/acceptance-scenarios.md#ac-05) | [context-selection](specs/context-selection.md) |
| SC-06 | Versioned memory and provenance: Preserve exact constraints and evidence, distinguish assumptions from facts, retain failed approaches and invalidate stale conclusions. | Core | [AC-06](specs/acceptance-scenarios.md#ac-06) | [memory](specs/memory.md) |
| SC-07 | Focused retrieval: Retrieve requested relevant sections; expose missing data and truncation. | Core | [AC-07](specs/acceptance-scenarios.md#ac-07) | [context-selection](specs/context-selection.md) |
| SC-08 | Three-mode tool routing: Profile effective tool context and choose a feasible execution mode per request. | Core | [AC-08](specs/acceptance-scenarios.md#ac-08) | [tool-mcp-safety](specs/tool-mcp-safety.md) |
| SC-09 | Local models and capability selection: Select only configured eligible models; support bounded local-only operation. | Core | [AC-09](specs/acceptance-scenarios.md#ac-09) | [model-capabilities](specs/model-capabilities.md) |
| SC-10 | Evidence-based acceptance: Verify actual intent, exact outputs and integration; protect validation criteria and bound independent assessment when selected. | Core | [AC-10](specs/acceptance-scenarios.md#ac-10) | [validation](specs/validation.md) |
| SC-11 | Bounded debugging: Test hypotheses, detect ineffective repetition and require an evidence-justified tactic change or stop at no-progress limits. | Core | [AC-11](specs/acceptance-scenarios.md#ac-11) | [attempt-tracking](specs/attempt-tracking.md) |
| SC-12 | Evidence-based replanning: Preserve still-valid work; explicitly obsolete or revalidate affected work. | Core | [AC-12](specs/acceptance-scenarios.md#ac-12) | [replanning](specs/replanning.md) |
| SC-13 | Durable state and recovery: Prevent lost updates, reject stale reports and reconcile interrupted attempts. | Core | [AC-13](specs/acceptance-scenarios.md#ac-13) | [supervisor](specs/supervisor.md) |
| SC-14 | External effect reconciliation: Record intents and uncertain outcomes; do not blindly repeat non-idempotent effects. | Conditional: effects | [AC-14](specs/acceptance-scenarios.md#ac-14) | [effects-recovery](specs/effects-recovery.md) |
| SC-15 | Budgets and progress watchdogs: Account for all work, require evidence of progress and preserve aggregate limits across retries, tactic changes and reviews. | Core | [AC-15](specs/acceptance-scenarios.md#ac-15) | [budgets-watchdogs](specs/budgets-watchdogs.md) |
| SC-16 | Scoped authority and data protection: Enforce permissions outside prompts; reuse grants and protect data boundaries. | Core | [AC-16](specs/acceptance-scenarios.md#ac-16) | [safety-permissions](specs/safety-permissions.md) |
| SC-17 | Audit and decision history: Preserve redacted observable decisions, actions and evidence with traceable identities. | Core | [AC-17](specs/acceptance-scenarios.md#ac-17) | [logging](specs/logging.md) |
| SC-18 | Git project history: Record accepted outputs and compact audit references without unrelated changes. | Conditional: Git profile, default | [AC-18](specs/acceptance-scenarios.md#ac-18) | [git-workflow](specs/git-workflow.md) |
| SC-19 | Bounded storage: Bound writes and reads while preserving required evidence and recovery data. | Core | [AC-19](specs/acceptance-scenarios.md#ac-19) | [storage](specs/storage.md) |
| SC-20 | Execution environment capability: Select an available suitable environment without requiring a specific product. | Conditional: environment needed | [AC-20](specs/acceptance-scenarios.md#ac-20) | [cicd-environment](specs/cicd-environment.md) |
| SC-21 | Research quality: Resolve task questions using version-relevant evidence; bound investigation. | Conditional: research needed | [AC-21](specs/acceptance-scenarios.md#ac-21) | [research](specs/research.md) |
| SC-22 | Workspace sequencing: Keep current sequential policy and explicit ownership of workspace operations. | Core | [AC-22](specs/acceptance-scenarios.md#ac-22) | [execution-policy](specs/execution-policy.md) |
| SC-23 | Large-run scalability: Bound active work/history loading and support incremental planning and recovery. | Core | [AC-23](specs/acceptance-scenarios.md#ac-23) | [scalability](specs/scalability.md) |
| SC-24 | Evaluation and honest coverage: Demonstrate invariants and report quality, resources and autonomy without requiring competitor data. | Core | [AC-24](specs/acceptance-scenarios.md#ac-24) | [evaluation](specs/evaluation.md) |
| SC-25 | Host integration contract: Verify actual host capabilities and preserve core guarantees through integrations. | Conditional: host adapter | [AC-25](specs/acceptance-scenarios.md#ac-25) | [pi-extension-architecture](specs/pi-extension-architecture.md) |
| SC-26 | Autonomous lifecycle and completion: Continue authorized work; pause/cancel safely; accept only the current complete deliverable. | Core | [AC-26](specs/acceptance-scenarios.md#ac-26) | [supervisor](specs/supervisor.md) |
| SC-27 | Requirement ledger: Preserve original intent and authority separately from assumptions; trace coverage, task necessity and current acceptance evidence. | Core | [AC-27](specs/acceptance-scenarios.md#ac-27) | [runtime-prd-ledger](specs/runtime-prd-ledger.md) |

## Legacy mapping

This maps intent, not implementation status. Historical IDs are not reused or
deleted. All old claims must be reassessed against the new criteria.

| Legacy IDs | Revision 2 requirements | Treatment |
|---|---|---|
| PRD-P01, PRD-P02 | SC-05, SC-06, SC-07 | Replace context aspirations with admission and provenance guarantees |
| PRD-P03, PRD-G01 | SC-04, SC-09, SC-15, SC-23, SC-24 | Economy and local-model usefulness require observable evidence |
| PRD-P04 | SC-08 | Isolation becomes one of three routes |
| PRD-P05, PRD-G02, PRD-G03 | SC-02, SC-03, SC-04, SC-10 | Preserve useful task boundaries without mandatory agent creation |
| PRD-P06, PRD-G04 | SC-11, SC-15 | Bounded attempts and early checks |
| PRD-S01, PRD-S02 | SC-01, SC-13, SC-26 | Shared authority and recovery rules |
| PRD-S03 | SC-04 | Replace keyword levels with evidence-based proportionality |
| PRD-S04, PRD-S05 | SC-05, SC-07 | Complete context and missing-input handling |
| PRD-S06, PRD-S07 | SC-06, SC-21 | Research remains conditional |
| PRD-S08, PRD-S09 | SC-08, SC-14 | Tool route and effect safety are separate decisions |
| PRD-S10, PRD-S11 | SC-05, SC-06, SC-07 | Enforce actual shrink or split before admission |
| PRD-S12, PRD-S13 | SC-06, SC-07 | Exact, scoped retrieval and freshness |
| PRD-S14, PRD-S15 | SC-02, SC-04, SC-09 | Shared contracts and capability-based agents |
| PRD-S16 | SC-17 | Observable history, privacy and retention |
| PRD-S17 | SC-19 | Core storage bounds; advanced management optional |
| PRD-S18 | SC-15, SC-26 | Resource bounds and autonomous lifecycle |
| PRD-S19, PRD-S20 | SC-11 | Evidence-based retry control |
| PRD-S21, PRD-S22, PRD-S24 | SC-10 | Domain validators, proportional checks and integration acceptance |
| PRD-S23, PRD-S27 | SC-16, SC-20 | Environments/scanners are capabilities, not required brands |
| PRD-S25 | SC-03, SC-12 | Incremental plans and validity-aware preservation |
| PRD-S26 | SC-14, SC-16 | Scope-bound grants and external-effect handling |
| PRD-S28 | SC-18 | Compact audit history plus artifact retention |
| PRD-S29 | SC-25 | Pi remains first host; architecture deferred |
| PRD-S30 | SC-22 | Sequential workspace policy retained |
| PRD-S31 | SC-27 | Requirement versions and acceptance evidence |
| PRD-W01, PRD-W02, PRD-W03, PRD-W04 | SC-03, SC-04, SC-21, SC-27 | Stages are optional activities/templates |
| PRD-W05 | SC-02, SC-04, SC-22 | Sequential operations; not necessarily a new agent per task |
| PRD-W06, PRD-W07 | SC-10, SC-20 | Software and non-software validation contracts |
| PRD-W08 | SC-12, SC-27 | Evidence-driven requirement/plan changes |

## Scope exclusions

Core acceptance does not require concurrent agents, cloud models, embeddings,
a service cluster, Kubernetes, an agent marketplace, automatic self-modification,
or a benchmark against another agent product. Optional mechanisms must meet
the same authority, budget, evidence and recovery guarantees when enabled.
