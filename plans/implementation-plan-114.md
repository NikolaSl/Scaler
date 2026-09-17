# PLAN-114 — Revalidate dependency evidence before worker admission

## Scope

Task selection currently treats membership in `validatedTaskIds` as sufficient
dependency proof. That label is useful for scheduling, but it can outlive the
validation receipt, accepted Git decision or declared output it represents. A
ready downstream task can therefore dispatch a worker after its predecessor's
accepted output has changed; the aggregate completion guard notices the stale
predecessor only after unnecessary work and model budget have already been spent.

Keep synchronous `selectNextTask` and `dependenciesSatisfied` as cheap scheduling
hints. Before either the normal conductor or debug-retry route admits a worker,
require each declared dependency to have current accepted evidence using the same
read-only proof used at final completion: current task/receipt/attempt/policy/
context/declared-output identity plus a matching accepted commit or reasoned skip,
and current committed outputs where applicable. Check under the execution lock,
before context/budget side effects, and check again at the shared attempt-admission
boundary to close the interval before durable admission.

This unit verifies direct declared dependencies only. It does not infer dependency
edges, prove semantic adequacy, validate integration criteria, authorize policy
changes or claim the whole dependency graph is correct. Those remain P2.3/P4 work.

## Ordered work

1. Commit this plan. Reproduce a validated predecessor whose accepted declared
   output is changed before a dependent conductor dispatch. Assert no runner,
   attempt record, task transition or spawned-agent charge occurs. Preserve a
   current-evidence positive control and an unrelated-task control.
2. Extract the existing per-task completion proof into one read-only acceptance
   helper. Keep final completion behavior and diagnostics covered; do not create
   another accepted-state store or silently repair stale evidence.
3. Use the helper for pre-admission dependency verification in both conductor
   routes and at shared attempt admission. A refusal remains explicit and leaves
   the dependent task runnable only after the predecessor is reconciled and
   revalidated; no worker replay or automatic revalidation.
4. Run focused tests, TypeScript build, unit/mock integration and conformance.
   Save implementation and evidence in separate commits, request exact-head
   Copilot review, address valid findings, and merge only after all checks pass.

No paid provider, deployment, mandatory second model or new orchestration layer.
P2.3 and SC-01/03/06/10/26 remain incomplete after this bounded guard.

## Result

The baseline dispatched `T-NEXT` after `T-DEP`'s accepted declared output was
changed. The new shared verifier factors the same current receipt, attempt,
policy, context, declared-output and accepted Git decision checks used by final
completion. Normal conductor and debug-retry preflight use it under the execution
lock before context/budget work; shared attempt admission checks again before
writing an attempt. Refusal neither calls the runner nor creates an attempt,
changes the dependent task, or charges `spawnedAgents`.

Copilot review identified that the shared recheck could still throw after the
projected budget had been published. Dependency admission now raises a typed
rejection with dependency-scoped diagnostics, both callers return their normal
structured refusal, and budget publication follows successful admission. Two
deterministic race tests mutate accepted dependency output after preflight in
the normal and debug-retry routes and prove no worker, attempt or spawned-agent
charge occurs.

Six focused checks cover the reproduced stale dispatch, both late-race paths, a
current accepted dependency, the shared admission boundary and an unrelated
stale task that must not block independent work. The completion suite retains
its existing outcomes. Final gate: build, 702 unit, 67 mock integration and 7
conformance/autopilot pass.

Only direct declared dependencies are checked. Dependency discovery, transitive
semantic sufficiency, affected-plan invalidation, declaration/policy authority
and final integration acceptance remain open.
