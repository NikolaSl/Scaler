# Evidence-Based Acceptance
Requirements: SC-10. Acceptance: AC-10.

## Required policy

Define acceptance before implementation. Every task has a proportional validation
policy tied to expected outputs and Definition of Done.
Validation MUST bind to the task/requirement version, attempt, exact output
version/hash and relevant environment/configuration.

Changing relevant inputs or outputs after validation MUST invalidate acceptance
for the changed version. All paths to accepted state MUST enforce this rule.
A worker's passed report, valid JSON, a reference string or a populated checklist
is an observation/proposal, not independently sufficient proof.

## Validator types

- Deterministic checks: command results, schemas, calculations, artifact checks.
- Evidence-backed assessment: explicit rubric, cited evidence and limitations.
- Independent review: optional when impact or uncertainty justifies its cost.
- Human decision: only where authority, ambiguity or non-automatable acceptance
  requires it; use existing delegated authority where applicable.

A second LLM agreeing is not objective proof. Review policy must identify what
additional evidence/independence it contributes. Inconclusive work remains
unverified or blocked unless the user explicitly revises acceptance criteria.

## Independent assessment when selected

For a direction check selected under SC-04, an independent reviewer MUST receive
the relevant original user wording, current authorized decisions, exact constraints
and source references, not only the worker's interpretation. Context stays within
SC-05; unresolved omissions of material intent prevent a conclusive assessment.
Before seeing the candidate's rationale, derive a compact expectation and material
ambiguities from those sources, then compare the candidate to that expectation.
This separation is conditional on using model review, not a mandatory extra call
for every task. Do not inherit the worker's full conversation by default.

Record conforms, mismatch or inconclusive, with requirement/source references,
evidence, consequential uncertainty and a resolving check where needed. A reviewer
may find no issue; never require a quota of objections or alternative hypotheses.
Test for missing coverage AND invented scope, including in the review itself.
Reviewers propose findings; they cannot change requirements or accepted state.

Disagreement is resolved by relevant evidence, a bounded experiment or a user
decision about genuine intent/authority ambiguity. Neither majority agreement,
model prestige nor self-reported confidence establishes correctness. Set finite
review/clarification limits before dispatch; when reached, stop debate and either
perform an admissible resolving check or report the affected decision blocked.
Further reviewers do not reset these limits. An unresolved material mismatch
cannot be accepted by relabeling the assessment as optional.

## Integrity of the checks

An implementation fix MUST NOT silently weaken acceptance, delete a failing check
or alter a mock to validate an invented interface. Where practical, reproduce the
original defect and show the relevant check fails before repair and passes after;
otherwise record an adequate task-specific alternative and its limitation.
Changes to the validation basis require separate justification against the
original requirement and version-bound reassessment through the same authority
rules. A demonstrably wrong test can be corrected without expanding product scope.
Green checks establish only the behavior they actually exercise.

## Software and non-software profiles

Software checks may include build/type checks, focused tests, integration,
regression, security and environment acceptance when relevant. Prefer test-first
where practical; record a justified alternative for documentation, trivial edits,
exploration or cases where it provides no useful evidence. Do not require fake
test_first command labels to satisfy a process.

Non-software outputs use task-specific completeness, consistency, calculations,
source support, constraint compliance, adversarial checks and uncertainty criteria.
Check evidence contents and relevance, not merely the existence of references.

## Execution and completion

Run the smallest useful check first. After a repair, rerun the failing check and
the required affected validation set. Reuse results only when input/output and
environment identity make reuse valid.
Required skipped checks need a policy-authorized, explicit alternative or waiver
with its limitation; agents cannot waive their own acceptance requirements.

Task acceptance requires outputs, current evidence, no consequential unresolved
blocker and the applicable history policy. Acceptance of the overall run
additionally requires checking integration and requirement-level criteria:
passing components may compose badly or solve the wrong task.

Validation environments are capabilities per SC-20. Missing infrastructure cannot
silently convert a required check into success.
