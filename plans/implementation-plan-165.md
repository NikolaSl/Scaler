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

## Outcome

The current-agent provider boundary now consumes an explicit host-owned
`allowed | denied | unknown` decision and the shared direct/isolated/replay
boundary plus current-agent admission re-evaluate the existing live budget
ledger immediately before dispatch. Hard limits refuse before ownership or
provider traffic; successful route records retain the allowed authority and
full budget decision. No permission service, recovery policy or new router was
added.

The coherent three-route fixture repeats under declared 32,768- and
131,072-token windows and now exercises denied authority and hard-budget
refusal for direct, current-agent and isolated routes. Candidate validation:
TypeScript build, 1,208/1,208 unit/component, 73/73 mock integration, 10/10
conformance/autopilot and 13/13 focused safeguard checks pass with
`git diff --check`.

The first fresh-context GPT-5.6 Terra/high review found three valid gaps: the
installed current-agent and builtin-direct paths could not consume a real
host-owned denial, the budget decision could become stale while asynchronous
route evidence was collected, and durable continuation/finalization did not
validate the new safeguard evidence. Test-first regressions reproduce all
three. The minimal fixes bind authority to the host preparation, re-read the
budget inside the serialized execution claim, and reject incomplete or
mismatched safeguard records. A new exact-head independent review is required
after these fixes before the phase PR can merge.

That review's exact-head follow-up found two further valid gaps: omitted
authority still defaulted to `allowed` for requests without permission prose,
and a structurally valid durable budget decision could replace the trusted
in-memory evidence during continuation. The follow-up regressions fail on both
paths. The host commands now pass an explicit decision, omitted authority is
always `unknown`, and continuation compares the durable safeguards with the
trusted execution record before adopting them. The full gate above covers the
updated candidate; another fresh exact-head review remains mandatory.
