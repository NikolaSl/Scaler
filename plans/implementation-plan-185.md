# PLAN-185 — Author assessment of selected review findings

SC-10/AC-10 and Nikola's explicit author-assessment rule distinguish reviewer
proposals from author decisions. Current `recordValidationChecklist` forwards
`adversarial_review` failures/blockers directly to `applyValidationReport`. An
unsupported reviewer demand for an Excel/plugin framework can therefore move a
correct bounded CSV task to debugging/blocked and trigger replanning before any
author assessment. A passed review already cannot grant acceptance.

## Bounded preparation, not an accepted implementation

Reproduce the negative-review automatic-effect path using the existing checklist
API, persisted state, original wording and ordinary validation controls. Keep the
regression RED on this preparation branch; do not merge or claim criteria covered.
No production code or new subsystem is introduced in this preparation unit.

The next executable fix must satisfy BOTH conditions:

1. A selected reviewer records findings/evidence, not task/requirement mutations
   or mandatory new scope. The author evaluates each finding against original
   wording/current authorized requirements; evidence-backed rejection of an extra
   feature leaves otherwise adequate acceptance possible.
2. An unresolved material finding remains acceptance-blocking until author
   assessment and evidence resolution; merely making review negative reports
   inert would weaken validation and MUST NOT be merged as the fix.

Reuse the existing checklist/validation-policy/receipt contracts where sufficient.
Before implementing, define the smallest persisted author-disposition contract,
bind it to the assessed candidate/requirement basis, and enforce pending/accepted
material findings at existing acceptance boundaries. Changed relevant basis must
invalidate reuse. Author disagreement needs evidence/reason, not a second model
vote. Required inconclusive findings remain blocked. No mandatory extra reviewer
call for routine work, role hierarchy, new general workflow framework or automatic
acceptance based on labels, references or model agreement.

Future acceptance fixtures: unsupported reviewer-created feature rejected by
author without scope mutation; a valid material constraint violation stays blocked
until repaired/current evidence; inconclusive bounded stop; correct minimal
candidate needs no invented objections. Preserve ordinary deterministic failed
validation behavior and all positive receipt checks. Full exact-head gate plus
independent fresh-context review required before any eventual implementation merge.

Broader expectation-before-candidate orchestration, risk triggers and full SC-10
remain open. This preparation records a concrete gap; it is not closure evidence.
