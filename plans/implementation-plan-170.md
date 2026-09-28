# PLAN-170 — Invalidate changed requirement coverage

## Reproduced gap

An explicit user-authorized amendment creates a new immutable runtime requirement
revision, and validation receipts bind the old requirement content. However,
`amendPrdRequirement` leaves the current coverage entry unchanged. A requirement
whose accepted basis has changed can therefore still be displayed as `validated`
until a later completion or receipt check discovers the stale evidence. This is an
ambiguous FSM state at the AC-06/12/27 boundary.

Baseline: merged PLAN-167–169 / PR #34, exact tree
`003cfc8da7f37b9766b28896450c8dc5d3b9404e`.

## Minimal unit

1. When an authorized amendment changes the requirement statement, source or
   acceptance criteria, mark only that requirement's coverage `needs_replan` in
   the same existing PRD-ledger lock.
2. Preserve linked task IDs, evidence references, notes, immutable requirement
   versions and unrelated requirement coverage. Historical evidence is not erased;
   it simply no longer establishes current acceptance.
3. Do not invalidate coverage for a title-only presentation change.
4. Do not add a new status, ledger or transaction layer, automatically rewrite
   validated task state, or infer which corrective task is necessary. A later
   affected-only replanning unit owns task reopening/replacement.

## Test and commit sequence

- Commit this bounded plan first.
- Add failing regressions for changed accepted content, title-only changes and
  isolation from unrelated coverage.
- Implement the smallest coverage update inside the existing amendment lock.
- Run focused PRD/completion checks, build and the applicable full gate once the
  implementation stabilizes; keep SC-06, SC-12 and SC-27 Partial.

This unit establishes truthful current coverage after a requirement change. It
does not prove semantic impact analysis or complete affected-only replanning.

## Outcome

Implemented on `implementation/v2-p4-requirement-invalidation`. Material
statement, source and acceptance-criteria amendments update only the matching
coverage row to `needs_replan` inside the existing PRD lock. Existing links,
evidence, notes and unrelated rows are retained; title-only changes leave
coverage unchanged. The candidate passes build, 1,218 unit/component, 73 mock
integration and 10 conformance/autopilot checks. SC-06, SC-12 and SC-27 remain
Partial: affected task reopening/replacement and semantic necessity are outside
this bounded unit.
