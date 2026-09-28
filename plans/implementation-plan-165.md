# PLAN-165 — P3 route authority and budget admission

## Reassessment

The three-route AC-08 fixture already proves deterministic direct,
current-agent and isolated selection across 32K and 128K declared windows.
Two execution safeguards remain incomplete: current-agent admission currently
assumes permission is allowed, and no route refuses a provider/tool dispatch
when the live SCALER state has reached a hard budget limit.

The minimal sufficient change reuses the existing route authority enum and
budget ledger. It does not introduce a permission service, approval workflow,
new routing policy or model-specific behavior.

## Bounded unit

1. Require the host to supply the current permission decision at each
   current-agent provider admission; denied or unknown authority must fail
   before a durable execution claim or provider call.
2. Re-evaluate the existing live budget ledger immediately before direct,
   current-agent or isolated dispatch. A hard limit refuses execution; a soft
   limit remains an advisory safeguard and is retained with the admission.
3. Persist the accepted authority and budget decision identity in the route
   admission record so the supervisor can audit the exact dispatch boundary.
4. Extend the existing three-route process with denied-permission and
   hard-budget cases while retaining the varied-window and compact-envelope
   assertions.

## Validation

Run focused route/request/installed-host tests first, then the TypeScript build,
full unit/component, mock-integration and conformance/autopilot gates plus
`git diff --check`. Before merge, obtain a fresh-context GPT-5.6 Terra/high
review of the exact phase head and assess every finding against the complete
requirements and implementation context.

## Boundaries

This unit validates supervisor-owned FSM admission and evidence. It does not
prove local-model quality or savings, configure a local provider, infer
permissions from prose, or add automatic approval and budget-recovery policy.
