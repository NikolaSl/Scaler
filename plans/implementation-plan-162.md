# PLAN-162 — P3 three-route process acceptance

## Reassessment

SC-08 requires SCALER to profile the effective selected-tool envelope and choose
one feasible route for each request: exact direct execution, current-agent work
or an isolated worker. The three execution boundaries already exist. The
remaining acceptance gap is one coherent scenario that exercises them under
the same supervisor-owned routing rules.

The installed Pi command cannot know the parent's final post-extension provider
payload before a future isolated result is returned. Approximating that payload
would weaken the existing fail-closed boundary. A configured local-host process
run belongs to SC-09/SC-25; it is not necessary to validate SC-08's
model-independent routing FSM.

## Minimal unit

1. Add one integration scenario covering all three existing routes without new
   production routing machinery.
2. Exercise 32,768- and 131,072-token model windows, a small selected tool from
   a large catalog, an unknown output bound that blocks, and a changed schema
   fingerprint that forces a fresh profile identity.
3. Preserve the existing authority, provider-envelope, execution ownership,
   bounded-result and structured-evidence checks for every route.
4. Reconcile SC-08/AC-08 only if the scenario and the existing focused/full
   gates pass. Keep the installed isolated command's unavailable future-envelope
   supplier explicit as a host-integration limit under SC-25.

## Validation

Run the new scenario, focused routing/tool/provider-host tests, TypeScript build,
the full unit/component, mock-integration and conformance/autopilot gates, and
`git diff --check`.

## Explicit limits

This unit does not add a provider adapter, synthesize a future Pi payload, add
generic direct operations, select or score a model, or claim quality, savings
or a real local-host outcome. It validates the programmatic route-selection and
execution process using deterministic fixtures; SC-09 and SC-25 retain their
separate live-host obligations.

## Outcome

The coherent scenario now executes the exact direct adapter without a model
call, admits and completes a current-agent request, and admits and completes an
isolated request through the same runtime-owned result boundary. It repeats the
model-backed routes with declared 32,768- and 131,072-token profiles, measures
one selected tool from a 130-definition catalog, observes a changed schema
fingerprint, and verifies that an unknown caller-result bound blocks before the
runner.

The test-first scenario exposed one proportionality defect: the prior 1 MiB
serialized-result reserve made every isolated candidate infeasible at both
acceptance windows. The runtime-owned cap is now 16 KiB. Oversized results still
fail closed, and publication, durable-byte identity, ownership and concurrency
checks use the same bound.

The exact executable tree passes the TypeScript build, 1,187/1,187
unit/component tests, 73/73 mock integration tests, 10/10
conformance/autopilot tests, 89/89 focused route/tool/ledger checks and `git
diff --check`. This establishes SC-08/AC-08 at the model-independent core
routing boundary. The installed Pi command still refuses isolated execution
without a trustworthy final caller-continuation envelope; that adapter-specific
limitation remains SC-25, while configured local-only execution remains SC-09.
