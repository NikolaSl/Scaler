# PLAN-206 — Actual timeout diagnosis and unchanged-check repair profile

AC-11 asks for observable discrimination before repair, not only prompt wording.
Extend the existing mock debug-retry flow with real bounded Node commands: a
worker awaits missing input or an existing lock and writes its waiting stage.
Both initially time out under the same command. A separate actual command reads
that trace; declare input-vs-lock predictions before execution. One alternate-
cause diagnostic control and one full repair flow suffice; no duplicate matrix.

Through normal scripted debug report ingestion and retry, deliberately propose
only cosmetic output. The unchanged worker/check must still time out, without
accepted task evidence. Then fix the observed cause, rerun the exact command and
required full validation, and verify current accepted evidence. Configure finite
command/aggregate agent/tactic/time bounds first. Use exec-node and a fixture
self-termination backstop; always drain real commands before deleting fixtures.

An actual first profile failed: initial validation timed out at its 1000ms cap,
but exact retry discarded that cap and reached the 5000ms fixture backstop.
ValidationCommandRunRecord omitted timeoutMs and the selector explicitly set it
undefined. Preserve optional timeoutMs in the existing actual command-run record
and copy it into exact replay. Refuse the entire selected set before dispatch if
a timed-out record has no positive finite cap, or a supplied cap is malformed;
do not infer limits from logs/elapsed time or borrow changed manifest options.
Historical non-timeout absent caps remain compatible, not proof of boundedness.
This is a concrete execution-bound loss, not a diagnostic-model failure.

Reuse public validation/debug/retry APIs and
existing evidence/history/budget contracts. This proves controlled local process
and effect composition, NOT autonomous model reasoning, semantic report policing,
general process-tree cleanup, all retry/cycle/exhaustion routes, full AC-11/15/P5
or local inference/quality/scale. Scripted invalid proposals are intentional
adversarial controls; no external effects/provider calls. Keep failed fixtures
distinct from product regressions. Own focused/build/full exact-head gate and
fresh source/rubric-first independent review before expected-head method merge.
No timeout/cap/assertion weakening or green sampling; no new framework or paid
inference/deployment/automation. Hard stop2026-10-27T22:50:08Z unchanged.
