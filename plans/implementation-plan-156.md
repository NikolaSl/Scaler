# PLAN-156 — Unknown-source research-to-section process milestone

## Requirement and minimal approach

SC-07 requires on-demand access to necessary context without requiring the
worker to know a file path beforehand. Existing local research, attributed
answer delivery and exact-section requests may already compose into that
process. Verify their actual FSM handoffs before adding another discovery API.

## Bounded scenario

A worker reports a missing-data question with no path. The supervisor creates
a local research request. An isolated research runner returns source candidates
as attributed claims. After a complete matching answer is admitted, the worker
chooses an explicit source and selector in a second missing-data report. The
supervisor supplies that exact section before the final worker may proceed to
validation. Assert the actual retry prompts, persisted requests, task statuses,
attempt identities and the exclusion of unrelated source bytes. Add a negative
control showing that incomplete research cannot dispatch the worker retry.

The runner output is deterministic test input. Do not claim actual local-model
discovery, source truth, full SC-07 completion, autonomous scheduling of the
research step, model quality or token savings. A completed task report advances
only to validation, not acceptance.

## Validation

Run the scenario against the current implementation. If a boundary fails,
preserve its reproduction and fix only that gap. If it passes, publish the
scenario and documented evidence without adding production machinery. Run
build, unit, mocked integration and conformance gates once on the candidate;
perform primary review and independent Terra/high review before handoff.

## Outcome

Both bounded scenarios pass against the existing production implementation.
The additional out-of-scope selection control stays blocked without a manifest
entry or worker dispatch. No production code change is needed for this composed
path. Unknown-source research remains an explicitly invoked step, and SC-07
remains partial.
