# PLAN-205 — Discriminating diagnosis responsibility in the existing debug prompt

AC-11 and specs/attempt-tracking.md require a smallest distinguishing check when
competing plausible causes imply different repairs, permit direct repair of an
already evidenced cause, and reject cosmetic symptom suppression. Existing
buildDebugAgentPrompt asks for evidence-backed next approaches and cycle avoidance
but does not supply these specific responsibilities to its diagnostic worker.

Use only the existing prompt and report fields: nextApproach for the discriminating
check/predicted outcomes, investigationSummary and evidenceRefs for observations,
rootCause for an evidenced cause, exhaustedReason for recoverable stop. Do not
add schema fields, a semantic classifier, mandatory hypothesis count, extra model
call, retry route or budget. One causal factor at a time where practical; justify
coupled changes and retain the underlying failing acceptance criterion.

Regress the public builder and actual prepared request for timeout ambiguity,
evidenced-cause and exhausted-approach contexts. This proves supplied model
responsibility and transport only, not correct diagnosis, a real timeout repair,
semantic enforcement, cross-task failure inheritance or full AC-11/P5. Existing
aggregate tactic/agent budgets and negative validation remain separate/intact.

First retain failing prompt-contract tests; then smallest prompt-only production
change, own focused/build/full exact-head unit/mock/conformance/diff gate and fresh
source/rubric-first independent exact-head review. No assertions/timeouts/caps
weakened, broad green sampling, paid inference, deployment or new automation.
SC03/04/10 remain Partial; P4/P5 incomplete/P6/P7 separate. Current hard stop is
2026-10-27T22:50:08Z; handoff/release/stop before it, no authorization extension.
