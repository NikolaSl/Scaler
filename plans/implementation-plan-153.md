# PLAN-153 — P3 manual answer reaches the next task attempt

## Status

Implemented on `implementation/v2-p3-proportional-routing`; PR #24 remains the
only PR in review.

## Observed gap

`/scaler-missing-context-resolve` records an operator answer only in the request
ledger and unblocks the task. The next worker does not receive the answer. It
also permits a manual summary to resolve an explicit file request that needs
exact source bytes.

## Bounded unit

For non-file requests, persist a bounded, attributed manual answer as required
inline task context before resolving the request. Reject blank/oversized answers,
absent tasks, and conflicting context identities without unblocking. Retrying
the same answer is idempotent. For an explicit file request, require the
existing scoped file dispatch instead of a summary-only manual bypass. The
next prompt still passes ordinary admission. This does not verify the truth of
an operator answer or infer a source path.

## Evidence and limits

The prior implementation failed the new tests: the manual answer never reached
the next task prompt, and a summary could resolve an exact file request.
The implementation saves a bounded required attributed answer before request
resolution, refuses conflicting identities and keeps repeat answers idempotent.
It refuses summary-only file resolution. This covers operator answers, not
their truth, source verification, automatic context selection or decomposition.

The executable candidate passes build, 1,159/1,159 unit/component, 68/68 mock
integration, 7/7 conformance/autopilot and 56/56 focused missing-context and
conductor tests plus `git diff --check`.
