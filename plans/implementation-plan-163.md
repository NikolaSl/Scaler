# PLAN-163 — P3 bounded report-only repair admission

## Reassessment

AC-05 requires the complete provider envelope to be rechecked during report
repair. Today a successful task-agent process with a missing or malformed
`scaler_task_report` is failed immediately. Re-running the original task would
repeat potentially completed file and tool effects, while accepting free-form
output would bypass the structured-report and attempt-identity boundaries.

The minimal safe repair is one separate, tool-less model call. It repairs only
the report for the still-current attempt; it cannot execute the task again.

## Bounded unit

1. Reproduce a successful task-agent run whose implementation effects are
   already present but whose structured report is malformed.
2. Permit at most one report-only repair call for missing or invalid reports.
   Bind it to the same run, attempt and task fingerprints and grant no tools.
3. Build a compact repair prompt from the required report schema, ingestion
   diagnostics and bounded original output. Apply the existing final-prompt and
   strict provider-envelope admission before dispatch; an oversized repair
   prompt blocks without truncating required identity or schema data.
4. Ingest only the repair call's structured report. Do not replay the original
   task, create a new task attempt or republish its effects. A failed, missing,
   malformed or identity-mismatched repair leaves validation blocked.
5. Record the original run and the repair run separately, including actual
   provider usage when available.

## Explicit limits

This unit does not add general retries, multi-turn self-correction, a new model
selection policy, permission architecture or provider adapter. It does not
repair implementation failures. One bounded report-only call is sufficient for
the AC-05 envelope boundary; broader attempt contracts remain SC-02/P4 work.

## Validation

Add test-first conductor regressions for successful repair, unavailable repair,
malformed repair, identity mismatch, no-tool invocation, one-call bound and
repair-prompt overflow. Run focused conductor/subagent/provider-admission tests,
then the TypeScript build, full unit/component, mock-integration and
conformance/autopilot gates plus `git diff --check` before phase review.

## Outcome

Conductor now permits exactly one report-only repair after an otherwise
successful task-agent process returns a missing or invalid report. The second
child receives the same complete attempt binding, no tools, the exact bounded
original output and the required schema. Its SCALER prompt is checked before
spawn and its final installed-Pi provider payload remains subject to strict
admission. A second spawned-agent budget decision is recorded; hard-limit,
transport, stale-identity, malformed, missing and oversized-prompt failures all
leave validation blocked without a third call.

The original task run and repair run have separate durable records and usage
accounting. Only the repair report is ingested when it passes the original
attempt identity. The task implementation is never replayed.

An installed-host scenario also exercises the preceding in-task boundary: a
9 KB tool result is externalized by the real Pi hook, and the next admitted
provider payload contains only the compact reference rather than the raw bytes.

SC-05 remains `Partial`. These bounded scenarios do not yet compose the entire
AC-05 oversized-source/split, real host envelope, post-tool continuation and
report-repair sequence into one declared-window milestone, nor reconcile each
admission estimate with observed provider usage.
