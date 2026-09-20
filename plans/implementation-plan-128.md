# PLAN-128 — P3 fresh-context handoff integrity

## Problem

`/scaler-context-handoff ... execute` is an existing public P3 route that starts a
task agent directly from an earlier context-split record. Unlike conductor and
debug-retry dispatch, it has no task-attempt identity, final prompt admission,
strict provider-payload admission, exact live-model binding, or result-acceptance
boundary. Its preparation path also trusts persisted split/externalization
metadata, silently omits unresolved minimal items, and clips non-externalized
exact content to a display-sized prefix. A smaller prompt estimate therefore can
be recorded as executable even when required facts are stale, missing or altered.

The installed host also cannot currently supply the trustworthy future
caller-continuation envelope required by PLAN-127. Reconstructing that evidence
inside this helper would invent authority and expand architecture speculatively.

## Bounded change

1. Add test-first regressions proving that preparation rejects stale or malformed
   split identity, missing required minimal items, altered/missing/non-regular
   externalized artifacts, and any required exact item that would be truncated.
2. Revalidate the selected split against the current task and current context
   manifest immediately before prompt publication. Externalized references must
   resolve to regular files inside the workspace and their stored identity and
   SHA-256 must still match the bytes used for the handoff.
3. Preserve required exact content byte-for-byte when it fits. A preparation may
   use a compact resolvable reference only after its exact externalized source has
   passed the checks above; it must never turn a clipped prefix into an exact fact.
4. Make `execute` fail closed before the runner while this route lacks the same
   task-attempt, strict provider and result-acceptance contracts as conductor.
   Keep safe preparation/listing available and record a fixed diagnostic that
   names the missing admission boundary without leaking filesystem errors.
5. Persist only a prepared/blocked handoff record with current fingerprints and
   diagnostics. Do not consume approval, change task state, or spawn a process on
   refusal.

## Acceptance boundaries

- a current, internally consistent split with intact exact sources prepares a
  prompt below the target without changing exact bytes;
- source mutation, deletion, symlink/FIFO replacement, hash/identity tampering,
  unresolved required items and task/split drift block before prompt publication
  or runner invocation;
- required exact inline content is either complete or blocked, never truncated;
- `execute` invokes no runner until a later unit supplies conductor-equivalent
  attempt, provider and result admission;
- malformed persisted handoff/split evidence fails closed with bounded fixed
  diagnostics;
- focused context-compaction/context-split tests, build, unit, mock integration
  and conformance gates pass on the final exact tree.

## Out of scope

This unit does not invent a future Pi continuation payload, authorize PLAN-124
route advice, implement a second executor, certify SC-08/AC-08, or claim real
model quality, savings or scale. Automatic effective splitting and executing a
fresh handoff through the full supervisor contract remain later bounded work.

## Implemented result

Preparation now validates the versioned split and handoff ledger envelopes,
current task/manifest, every selected historical minimal item, and each
externalized artifact before prompt publication. Externalized identity is bound
across the split reference, memory index tags/source/task, stored item/task/split/
scope/exactness header and exact content hash; duplicate memory/path aliases are
rejected. Required inline exact content is emitted byte-for-byte, with explicit
`exact` semantics taking precedence over a `reference-only` presentation scope.

Malformed evidence returns fixed diagnostics, preserves an invalid handoff
ledger for diagnosis and publishes no prompt. The legacy `execute` argument
records a blocked handoff without invoking the injected runner or persisting an
invocation. The focused context-compaction/context-split selection passes 25/25.
The candidate gate passes the TypeScript build, `git diff --check`, 979/979
unit/component tests, 67/67 mock integration tests and 7/7
conformance/autopilot checks. This evidence covers the repository-owned mock and
conformance boundaries only; it does not establish production continuation
execution, model quality, savings or scale.
