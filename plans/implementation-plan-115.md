# PLAN-115 — Refuse incomplete task contracts before worker dispatch

## Reproduced gap

AC-02 requires execution to stop when required output identity, write scope or
acceptance criteria are missing. The current strict task-create routes review
some of these fields, but conductor/debug retry and shared attempt admission can
still dispatch a task loaded from state without an execution-complete contract.
The worker may therefore consume budget and perform effects before the missing
contract is discovered by validation or commit.

## Bounded change

Add one read-only task-contract verifier and use it:

1. under the execution lock before conductor/debug-retry worker preparation;
2. again at shared attempt admission, immediately before the attempt is written.

The verifier checks only the three AC-02 execution prerequisites:

- non-empty allowed path prefixes as the declared project write scope;
- an explicit declared-output basis in the validation manifest (`outputPaths`,
  where `[]` deliberately means no filesystem outputs);
- at least one concrete acceptance statement from task/manifest Definition of
  Done or manifest acceptance criteria.

Refusals are typed and converted into the existing structured conductor/debug
retry rejected results. They must happen before runner invocation, attempt
publication, task transition or spawned-agent accounting. A late contract
change between preflight and shared admission must retain the same guarantees.

## Deliberate limits

- Do not enforce atomicity-rationale length, PRD references, task kind, model,
  tool profile or other similar-but-not-requested quality metadata here.
- Do not infer exact outputs from broad permission prefixes, and do not turn
  worker-proposed files into authority.
- A compact routine contract remains concise: short scope/Done entries and
  explicit `outputPaths: []` are sufficient when no filesystem output exists.
  Automatic compact-default synthesis is not added in this unit.
- This does not establish semantic correctness, integration acceptance,
  declaration authority or full SC-02/P2.3 compliance.

## Verification and commits

1. Reproduce normal conductor, debug-retry and direct shared-admission bypasses.
2. Add complete-contract controls and a deterministic late-race regression.
3. Keep implementation/tests and result documentation in separate commits.
4. Run focused tests, TypeScript build, full unit/mock integration and
   conformance/autopilot gates.
5. Request Copilot review and merge only the reviewed exact head with no valid
   unresolved finding.

## Result

The four baseline regressions reproduced dispatch through conductor, debug retry
and shared admission, including a late contract mutation after preflight. The
shared verifier now refuses missing write scope, explicit output basis or
acceptance statement. Both callers return their existing structured rejection,
and the late check occurs before attempt publication and spawned-agent budget.

Five focused checks cover the three boundaries, late mutation and an explicit
compact contract with `outputPaths: []`. Existing execution fixtures now state
the contract they already assumed; their behavioral assertions are unchanged.
Copilot review exposed one earlier side effect: conductor could write a dirty-tree
pause checkpoint before rejecting a missing write scope. The preflight now runs
before git safety in execute mode, while the shared admission check still catches
late mutation; a sixth focused check locks that ordering. Manifest read failures
also preserve an `Error` message without adding a redundant `Error:` prefix.
Malformed legacy task/manifest field shapes are treated as missing declarations
and return the same structured refusal instead of throwing a type error; a seventh
focused check locks that fail-closed behavior. Final gate: build, 710 unit, 67
mock integration and 7 conformance/autopilot.

This is a structural admission guard only. It does not prove that declared paths
or criteria are sufficient, authorized or semantically correct, and it does not
synthesize defaults for routine jobs. P2.3 and SC-02/10/26 remain incomplete.
