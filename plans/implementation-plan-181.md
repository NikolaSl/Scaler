# PLAN-181 — Preserve original request in planning context

SC-02/10/27 distinguish original user wording from normalized requirements and
interpretations. `/scaler` receives exact user text, but `startScalerRun` retains
only a routing reason and stage/replan agents receive no original wording.
Adding another reviewer cannot correct a missing source.

Keep one optional `originalRequest` string in the existing state, captured without
trimming only on the first nonempty request for a not-started idle run. Later
routing calls preserve it; active legacy runs without the source stay explicitly
unavailable rather than treating a later request as their original one. Existing
state persistence/checkpoints retain the field without a new ledger or migration.

Expose the exact JSON-quoted text separately from interpretations in stage and
replan prompts. Missing legacy context is explicitly unavailable. Existing full
prompt admission must refuse oversized original wording, never silently clip it.
Do not copy the full original into every task/diagnostic child by default.

Regress exact whitespace/Bulgarian constraints across state reload and rerouting,
legacy absence, stage/replan delivery and oversized-prompt refusal. Run relevant
focused tests, build, unit/mock/conformance gate and independent exact-head review.
This is source availability only: no semantic necessity classifier, risk trigger,
selected-review protocol, authorized-decision history or complete SC-02/04/10/27
claim. Version-binding and semantic checks remain separate acceptance boundaries.
