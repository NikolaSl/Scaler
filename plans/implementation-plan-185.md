# PLAN-185 — Author assessment of selected review findings

SC-10/AC-10 and Nikola's explicit author-assessment rule distinguish reviewer
proposals from author decisions. Current `recordValidationChecklist` forwards
`adversarial_review` failures/blockers directly to `applyValidationReport`.
Its only public caller found is the manual `/scaler-validation-checklist` command;
neither its input nor record identifies reviewer origin or author disposition.
A gate label does not prove actor identity or absence of author assessment.
Therefore this is a missing selected-review submission/assessment contract, NOT
a demonstrated installed reviewer-authority bypass. If raw reviewer output were
fed into this manual API, it would have effects; no such route is demonstrated.
A passed manual checklist already cannot grant acceptance.

## Bounded preparation, not an accepted implementation

Characterize the manual checklist API using persisted state, original wording
and ordinary validation controls. Failed manual adversarial checks move tasks to
debugging; blocked checks move them to blocked/replanning; neither changes PRD
scope. Preserve this behavior, including same-gate manual negatives. An eventual
reviewer-specific regression must use explicit reviewer provenance/disposition,
not infer it from `gate`. No production change or SC-10 closure is claimed.

If a selected-review route is added, its executable unit must satisfy BOTH conditions:

1. A selected reviewer records findings/evidence, not task/requirement mutations
   or mandatory new scope. The author evaluates each finding against original
   wording/current authorized requirements; evidence-backed rejection of an extra
   feature leaves otherwise adequate acceptance possible.
2. An unresolved material finding remains acceptance-blocking until author
   assessment and evidence resolution; merely making review negative reports
   inert would weaken validation and MUST NOT be merged as the fix.

First assess whether an existing manual author decision plus external review
handoff can satisfy the selected profile with a representative acceptance scenario.
Do not introduce a new route/subsystem merely because it can be designed.
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

## Preparation review correction

The original two RED probes assumed that an adversarial gate implied reviewer
origin/no author assessment. Independent review correctly rejected that inference.
They are now accurate manual-API characterization controls, not claimed product
regressions. Removed whole-state equality: lawful pending/audit bookkeeping may
change revision while preserving task/stage/scope boundaries. Future selected-
review implementation must test pending valid findings at acceptance and retain
same-gate manual negative behavior. Do not merge the earlier inert-report shortcut.
