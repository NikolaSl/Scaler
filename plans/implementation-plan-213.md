# PLAN-213 — Carry reported failed approaches into implementation retry

AC11 and specs/attempt-tracking.md require a fresh worker to inherit compact
failed approaches. The actual public regression on main3d12828 writes an empty
payload, fails its real capped required command, records the failed attempt,
then ingests a scripted diagnostic report containing that attempt's ID/action
and validation reference in existing attemptedApproaches. The stored normalized
report retains it, but the actual tool-less implementation retry receives none
of that summary. Baseline fails at the dispatched request, not fixture setup.

Forward only the existing reported attemptedApproaches through the existing
required exact next-approach context item. Label them as reported history, not
verified causal truth, authority or a substitute for current validation. No new
field, loader, framework, default model call or semantic repetition classifier.
Do not change aggregate counters, retry gates, source/policy guards or timeouts.
Existing context/prompt admission must bound this context, not silently clip it.

The same scenario must then deliver the normalized history to the fresh worker,
repair only the candidate, pass the exact command and full current acceptance,
retain the original failed attempt and account for both calls. Existing no-history
and admission controls remain unchanged. This is one report-to-retry disclosure
boundary, NOT full AC11/15, cross-task history inheritance, semantic diagnosis,
model quality/local inference/savings/scale or P4/P5 completion.

Retain baseline RED; own focused/build/full exact-head unit/mock/conformance/diff
and fresh source/rubric-first independent exact review precede expected-head
method merge. No assertion/timeout/cap weakening, exclusions, paid inference,
deployment or new automation. Handoff/release/stop before2026-10-27T22:50:08Z.
