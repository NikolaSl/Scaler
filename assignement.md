# SCALER Product Requirements — Revision 2

Status: proposed product baseline for review; implementation has not been upgraded.
Revision date: 2026-09-16. Reviewed implementation baseline: d866b6957d0b79b455875e56b635ff8f774d0129.

## 1. Outcome

SCALER coordinates reasoning, tools, evidence and durable progress to complete
large or complex work with the least justified overhead. It must support
unattended continuation within granted authority and resource budgets, including
operation with a configured local model.

Success means an accepted result with traceable evidence and recoverable progress,
not a large agent count, a populated checklist, or a claim of completion.
No design can guarantee elimination of hallucinations or make every small model
capable of every task. SCALER must detect inadequate evidence, bound unsuccessful
work, and report capability limits without fabricating success.

## 2. Problems addressed

- Irrelevant and growing context increases distraction and repeated input cost.
- Repeated summaries can lose exact constraints and change facts.
- Tool schemas, documentation and outputs can crowd out task context.
- Unbounded retries, fragmented tasks and duplicated research waste resources.
- Agent claims, stale validation and inconsistent state can create false progress.
- Interruptions and uncertain external effects can make retries unsafe.
- Process overhead can exceed the benefit of delegation.

## 3. Scope and terminology

A task is a useful independently assessable unit of work.
An attempt is one bounded execution against specified input versions.
An agent is a reasoning session; creating one is a policy decision, not a
requirement for each task or tool call.
A supervisor is deterministic control logic that accepts proposals only through
shared admission, permission, budget and validation rules.
An artifact is a versioned output or evidence object, including non-code outputs.

The core is domain-neutral. Software work is the initial integration profile.
Pi remains the initial host; local model support must not require a cloud fallback.
Git is the default project history profile. Domain validators, research providers
and execution environments are integrations, not mandatory infrastructure.

## 4. Requirement authority

- This document defines goals, scope and precedence.
- [requirements-catalog.md](requirements-catalog.md) owns stable SC-* requirement IDs,
  obligation levels and acceptance links.
- [specs/index.md](specs/index.md) points to normative behavioral details.
- [specs/acceptance-scenarios.md](specs/acceptance-scenarios.md) defines observable
  pass/fail scenarios; presence of a module or test name is not acceptance.
- Current implementation assessment is in
  [requirements-v2-coverage.md](dev-progress-tracker/requirements-v2-coverage.md).
- Manuals describe existing behavior. Historical PRD-* matrices and implementation
  plans are evidence of earlier work, not proof of revision 2 compliance.

An explicit current user decision takes precedence. Conflicts within this baseline
must be reported and corrected, not silently resolved by weakening an obligation.
MUST means mandatory. SHOULD permits a recorded, justified exception. MAY means
optional. Conditional MUST applies when the named feature is enabled or needed.
Acceptance criteria add examples; they do not narrow the normative requirements.

## 5. Mandatory core guarantees

1. Agents propose actions and results; only the supervisor accepts authoritative
   progress through the same rules for every command, tool, hook and recovery path.
2. Every execution has a task contract and a minimal plan before effects occur.
   A one-task plan can be prepared without an LLM call or a separate document.
3. Ready work has satisfied dependencies, current inputs, a validation policy,
   sufficient permissions and an admissible context/resource envelope.
4. Context is bounded across the actual model request, including tools and reserved
   output. Required content is never silently removed to fit.
5. Exact sources remain retrievable. Derived summaries identify their sources and
   versions; invalidated evidence cannot silently justify new work.
6. Task results are accepted against their actual output versions. Agent statements
   and syntactically valid reports alone never prove correctness.
7. Retries, delegation, research and replanning are bounded and attributable.
8. State, evidence and external effects can be reconciled after interruption.
9. Existing authorization is reused within scope. The system pauses when authority,
   evidence, capability or resources are genuinely insufficient.
10. Completion covers the current user requirements and integrated result, not only
    a set of locally successful tasks.

## 6. Proportional execution

Select the lightest feasible route consistent with correctness and authority:
deterministic execution, the current reasoning session, or a new isolated agent.
For tool requests these are three explicit modes, specified in
[tool-mcp-safety.md](specs/tool-mcp-safety.md).

Clarification, research, planning, implementation, review and repair are reusable
activities. Stage I–IV is an optional workflow template for complex work, not a
mandatory linear pipeline. A bounded experiment may precede detailed planning.
Planning becomes more detailed near execution; distant work can remain coarse.

Delegation needs a recorded benefit: context separation, required capability,
independent review, reusable investigation or other justified gain.
A simple heuristic may decide this; no extra LLM call is required to justify every
LLM call. Uncertain estimates must be labeled and revised with observed usage.

## 7. Preserved concurrency policy

Current product baseline permits one active execution operation per mutable
project workspace, including read-only agent execution. Agents can run
sequentially and still benefit from context isolation.
Parallel execution is not required for core acceptance. A future opt-in profile
would require explicit authorization and a separately accepted consistency policy.
Legacy language allowing parallel tool requests does not override this rule.

## 8. Optional mechanisms

Containers, virtual machines, remote workers, Docker, Compose, dev containers,
Minikube, CI services, web research, MCP servers, vector search, model escalation
and specialized reviewers are optional capabilities.

If a task requires a capability, its absence must be resolved by an authorized
equivalent or reported as blocked. Optional installation never means optional
correctness. A container label alone is not evidence of security isolation.

## 9. Economy and scalability

Optimize total resource cost for an accepted result, including coordination,
validation, retries and recovery. Report time and human intervention separately.
Caching and local inference affect costs; token totals alone are not currency.

External-agent comparisons are not a prerequisite. Start with repeatable tasks
and absolute acceptance scenarios. Optional comparisons can later use the same
model in a simpler direct workflow. Do not claim measured savings without data.

Large runs must use bounded active context and bounded retrieval of history.
Scale targets and supported local model/resource envelopes must be declared,
measured and reported; no arbitrary model size or unlimited-scale promise is made.

## 10. Delivery boundaries

This revision changes requirements and coverage documentation only.
It does not choose a database, event transport, process topology, exact public
schema, module decomposition or replacement framework. Architecture and code
migration follow after review of this baseline.
