# Evaluation and Honest Coverage
Requirements: SC-24. Acceptance: AC-24.

## No competitor prerequisite

Core acceptance uses the absolute scenarios in acceptance-scenarios.md and
repeatable representative tasks. The user need not supply another agent system.
External comparisons and automatic optimization are optional future work.

## Measurement

For each evaluation record task/input version, model/backend, configuration,
permissions, environment, cache conditions, repetitions and outcome criteria.
Report separately:
- Accepted quality and unmet requirements; false acceptance.
- Input/output tokens for all agents, retries, planners and validators.
- Known monetary cost, estimated cost and unknown cost.
- Wall-clock time, local resource use when measurable and orchestration overhead.
- Retries, stalls, recoveries and necessary human interventions.
- Task/context size and retained evidence.
- Detected/missed departures from intent, unjustified scope additions, false review
  alarms, inappropriate blocks and the resources spent resolving them.

Total resources per accepted deliverable matter more than per-call savings.
A single successful example cannot establish broad reliability or economy.

## Test layers

1. Deterministic invariant and failure-injection scenarios.
2. Actual host API/adapter contracts, avoiding mocks that invent capabilities.
3. Local-model end-to-end tasks: code change, evidence-backed non-code output,
   missing-data recovery, bounded tool use and interruption/resume.
4. Scale fixtures within a declared resource envelope.

Include controlled cases with misleading task interpretations, unrequested
enhancements, assumptions repeated as facts, ineffective tactic changes, weakened
tests and reviewer-originated scope expansion. Include correct minimal solutions
and genuinely necessary prerequisites as controls against over-rejection.
For an enabled model reviewer, test independent input preparation and bounded
disagreement with both planted errors and correct candidates; report detection,
false alarms, missed errors and cost across declared repetitions. Model agreement
is not ground truth; use known fixtures and independently checkable outcomes.
Thresholds and model/resource envelopes must be declared before acceptance.

If later useful, compare routing policies or a simpler direct workflow using the
same model/task/quality criteria, with cache conditions reported. No comparison
result is implied by the specification.

## Coverage language

Use Not assessed, Partial, Failed, Verified for declared envelope, or Not applicable
with a documented condition. Link results and implementation revision.
A source file, passing schema test or filled traceability row is not verification.
Changing a requirement reopens its assessment; historical proof is not discarded.
