# PLAN-202 — Resolve a declared current requirement slice at worker admission

SC-02/06/07/27 require current task-relevant constraints without copying the full
original request or ledger to every child. An actual public-route probe found
that default context discovery saves `runtime-prd-coverage` as inline JSON.
After authorized CSV requirement amendment, the same cached manifest sends the
old statement to normal conductor's runner and excludes the current statement.
This is source freshness, not semantic necessity or model-quality evidence.

Add one explicit `prd_requirements` manifest source using the existing requirement
loader. Resolve the selected task's current refs and exact requirement
records on each resolution. Missing task/linked requirements are unavailable,
not an apparently complete empty slice. Newly discovered ledger-backed current
requirement items are required, so existing context/budget guards refuse when
unavailable or oversized. Preserve ordinary caller inline/historical snapshots;
do not reinterpret an item ID as source authority or silently overwrite manifests.

Compatibility is deliberately bounded: existing inline manifests need explicit
replacement of the snapshot with the dynamic source; context-init preserves them.
Refs-only tasks with no runtime ledger retain existing compact-contract behavior,
not a claim of retrieved current facts. A manifest created before refs are added
also needs explicit current-source selection. No automatic migration or generic
context-refresh framework. Concurrent source mutation after resolution and other
discovered snapshots remain separate; do not claim all-route transactionality.

Regress actual default-manifest reuse after authorized amendment, current linked
slice/unrelated exclusion, required-source loss before dispatch/accounting, and
intentional inline history preservation. Use public APIs and actual conductor;
failed injected runner proves prompt delivery/admission only. First retain RED,
then focused/build/full exact-head unit/mock/conformance/diff gate and fresh
source/rubric-first independent review before phase acceptance. No timeout/cap/
assertion weakening. SC03/04/10 and P4/P5 stay Partial/incomplete; no semantic CSV
coverage, full original-intent correctness, local inference/quality/scale claim.
No paid inference/deployment/new automation; release ownership at handoff and
stop before renewed cutoff2026-10-27T22:50:08Z.

Independent review found a valid material flaw in the first candidate: including
computed coverage made successful acceptance change its own context fingerprint.
Three existing autopilot regressions failed the full unit gate, and a new actual
completed-report/validation/accepted-evidence control reproduced the failure.
Exclude only volatile computed coverage from this source, not requirement records
or context fingerprinting. Preserve successful accepted reuse and dependent
admission; a later authorized amendment must still invalidate that same evidence.
Retain failed logs; require new exact-head full gate and re-review, not green
sampling or an acceptance waiver.
