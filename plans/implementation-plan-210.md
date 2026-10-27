# PLAN-210 — Strict memory source identity at result recheck

PLAN209's strict memory descriptor intentionally has outputExemptible=false.
The shared verifier checks the reader's detected direct-path identity drift only
when that original descriptor is true. A real public checkTaskExecutionResult
reproduction reads the original unchanged source inode, then replaces its ancestor
with a symlink before the reader's final path check. The reader detects drift,
but the strict descriptor currently yields no diagnostic. This is a freshness
guard gap, not proof of whole-task acceptance, semantic truth or an actual effect.

Reject reader-detected identity drift regardless of the original descriptor's
output-mutation exemption. Preserve the separate declared-output byte exemption
and all history, source binding and legacy semantics. Reuse existing reader and
attempt guards; no schema, extra model call, framework or new lifecycle.

Regress normalized research producer → bound memory → actual admitted/started
attempt → public result check. First assert unchanged direct source passes;
then observe the real post-read ancestor check, swap the real directory to a
symlink while leaf bytes remain unchanged, and require diagnostics with state
preservation. Keep existing ordinary declared-output mutation controls unchanged.
Retain baseline RED, focused/build/full exact-head unit/mock/conformance/diff and
own review plus fresh source/AC-first independent exact-head review before merge.
No assertion/timeout/cap weakening, paid inference, deployment or new automation.
SC03/04/10 remain Partial, P4/P5 incomplete; no full AC06 or model-quality claim.
Handoff/release/stop before hard cutoff2026-10-27T22:50:08Z.
