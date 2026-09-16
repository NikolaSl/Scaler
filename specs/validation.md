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
blocker and the applicable history policy. Run acceptance additionally checks
integration and requirement-level criteria: passing components may compose badly.

Validation environments are capabilities per SC-20. Missing infrastructure cannot
silently convert a required check into success.
