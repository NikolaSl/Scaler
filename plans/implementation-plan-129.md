# PLAN-129 — P3 stage-agent prompt and provider admission

## Observed prerequisite gap

The shared stage-agent path can execute PRD, knowledge, planning, execution and
replanning prompts without the final prompt-size admission used by conductor and
debug retry. It also omits strict provider admission from the child request.
A large generated stage prompt can therefore reach the runner with
`providerAdmission` absent, allowing the installed host to compose and send an
unbounded or differently-modelled provider request.

This is an active shared path, so it precedes optional route expansion and model
quality work.

## Bounded unit

1. Add an explicit stage-agent token allowance, defaulted through the existing
   task-prompt admission policy. Reject non-positive, non-finite and oversized
   final prompts before prompt audit, run-record publication or runner dispatch.
2. Attach the same runtime-owned strict provider admission policy used by
   conductor and debug retry to the exact request passed to the runner.
3. Build the invocation from that strict request so child processes suppress
   ambient extensions, skills, templates and context files and load only the
   allowed SCALER/provider admission extensions.
4. Preserve stage tool selection, prepare mode, structured artifact ingestion,
   usage accounting and execution-lock ownership. A refusal must call no runner
   and publish no successful/prepared stage-agent run.
5. Keep provider payload validation and live-model identity enforcement in the
   installed provider hook; do not duplicate its estimator in the stage runner.

## Test-first evidence

- an oversized generated stage prompt and invalid allowances reject with zero
  runner calls and no stage-agent run record;
- an exact-boundary prompt remains admissible;
- the executed request carries the strict policy and the rendered invocation
  contains the strict isolation flags and admission extension;
- prepare mode remains available with the same strict invocation contract;
- existing stage report ingestion and supervisor orchestration remain green.

Run focused stage-agent, stage-conductor, provider-admission and subprocess
tests, then build, full unit, mock integration and conformance/autopilot gates.
Two independent GPT-6 Astra/high reviews inspect the exact final tree.

## Explicit limits

This unit does not classify task complexity, prove planning proportionality,
automatically split tasks, implement missing direct/current-agent adapters,
wire a production continuation supplier, or claim local-model quality, savings
or scale. Those P3 acceptance rows remain partial.
