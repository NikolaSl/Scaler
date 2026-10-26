# PLAN-194 — Configured selected-review sequencing and aggregate stop

SC-10/15 require source-first expectation and finite review limits when review is
selected. Existing PLAN-189 exercises supplied external findings/manual author
assessment, not child sequencing or a replacement reviewer's aggregate budget.
First test the existing conductor, context manifests and run budget; do not add
a reviewer role/subsystem if ordinary tasks already satisfy this narrow profile.

Fixture: explicit local-only request and authorized no-plugin decision. A selected
review is configured as two sequential non-software tasks: EXPECT derives a compact
expectation from those exact sources, COMPARE receives that accepted expectation
plus the candidate and misleading rationale. Tools are empty and model identity
is synthetic. Scripted children supply expectation/inconclusive observations, not
real model assessments. Assert actual outgoing prompt order/content, attempt-bound
report ingestion and objective expectation-artifact acceptance before comparison.
An inconclusive COMPARE report must leave that task blocked/unaccepted.

Set spawnedAgents hard=3 before work: inclusive admission permits two calls and
refuses the third. Reload durable state, create a replacement reviewer with a new
task ID and a fresh runner, and prove zero additional calls, unchanged aggregate
usage and a persisted hard-limit pause. This is a conservative all-child cap,
not a new review-specific counter or a wall-clock/clarification guarantee.

Together with PLAN-189's external author-disposition controls and PLAN-193's
dependency freshness, this can establish additional configured process evidence,
not automatic risk selection, semantic expectation/necessity, general reviewer
independence/quality, actual local inference or full SC-10/15/P4/P5. No automatic
two-call overhead for routine objective tasks. Keep unsupported extras and raw
manual negative validation behavior unchanged. If the scenario is already green,
production remains unchanged; report exact limitations and remaining work.

Own focused/build then applicable full exact-candidate gate and source/AC-first
independent exact-head review precede PR acceptance. No RED merge, weakened check,
new automation, paid external inference or deployment. Current authorization,
checked ownership and expected-head merge policy remain unchanged.
