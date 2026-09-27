# PLAN-138 — P3 effective oversized-context dispatch

## Status

Implemented on the P3 preparation branch; final phase review and merge remain
pending.

## Observed prerequisite gap

The conductor already records deterministic context splits and externalizes
large exact or summary-eligible items. A separately prepared fresh handoff also
revalidates the current manifest and externalized bytes. However, normal
conductor execution still measures and dispatches the original oversized
request. The split is therefore durable evidence and a manual continuation aid,
not yet an effective execution path.

Enabling the legacy handoff runner directly would bypass the attempt, provider,
result and structured-report admission added after that feature was introduced.
The bounded next step is to let the conductor use a validated minimal projection
while retaining those normal execution gates.

## Bounded unit

1. Derive a deterministic minimal context projection only from the just-created
   split and the same currently resolved items. Required context remains present;
   items selected for externalization become compact immutable references to the
   stored memory id, path, exactness and SHA-256.
2. Validate the split identity, complete externalized-ref coverage, source bytes,
   item identity and the current task before the projection can replace the
   oversized prompt. Malformed, missing, foreign or stale evidence fails closed.
3. Rebuild and measure the complete final task-agent prompt, including the
   attempt-report envelope, from the projected context. Dispatch is permitted
   only when this actual prompt is within the current allowance and smaller than
   the original request.
4. Admit the task attempt through the existing conductor path. Bind the input
   fingerprint to the projected context while retaining the original file-source
   freshness descriptors for every projected item so source mutation is checked
   before dispatch and on result acceptance.
5. Keep provider admission, exact model identity, tool allowance, budgets,
   lifecycle transitions, result limits and structured-report ingestion
   unchanged. The legacy `/scaler-context-handoff ... execute` route remains
   blocked.

## Test-first evidence

- an oversized required exact item is externalized and the normal conductor
  dispatches only the bounded projected prompt through the existing runner;
- the attempt input fingerprint and audited prompt describe the same projected
  request, while the original file source remains freshness-bound;
- missing, duplicate, foreign, malformed or byte-mismatched externalized refs
  refuse dispatch without an attempt, spawned-agent charge or running state;
- a projected prompt that still exceeds the complete final allowance is refused;
- mutation of an original file source after projection and before dispatch, or
  before result acceptance, is rejected by the existing context-freshness gate;
- preview continues to record the split without authorizing execution, and a
  request that does not need splitting follows the unchanged conductor path;
- the direct fresh-handoff execution command remains fail closed.

Run focused conductor/context-compaction tests after each meaningful change and
the full build, unit/component, mock-integration, conformance/autopilot and diff
gate on the candidate.

## Explicit limits

This unit does not invent semantic selectors, automatically decompose a task,
enable direct/current-agent adapters, configure or call a local model, prove
quality or savings, or authorize any route outside the conductor. It does not
complete SC-07, SC-08 or SC-09. It closes only the bounded gap between an
already justified oversized-context split and an admitted isolated task-agent
request.

## Implementation evidence

- Conductor derives the dispatch projection from the just-created split and
  currently resolved context, preserves every required item, and replaces only
  verified externalized items with bounded memory id/path/hash references.
- Externalized memory bytes and any original file source are both attempt-bound
  and revalidated before dispatch and result acceptance. The referenced memory
  path is an explicit read-only prompt exception, never a write/edit allowance.
- Missing `read`, incomplete or duplicate refs, altered memory bytes, foreign
  item identity, a non-shrinking projection and an over-limit final wrapper all
  refuse before runner dispatch. The legacy direct handoff executor is unchanged.
- The candidate passed build, 1,107 unit/component tests, 67 mock integration
  tests, 7 conformance/autopilot tests, 72 focused conductor/context
  split/context-compaction checks and `git diff --check`.
