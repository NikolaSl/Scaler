# PLAN-173 — Require referenced evidence for debug retry admission

## Reproduced gap

`recordDebugAttempt` currently accepts a repeated failed attempt whenever the
model supplies any non-empty `newEvidence` prose. The same unchecked string
also clears a blocking fingerprint-cycle gate. A rewritten claim such as
`"new observation"` can therefore resume an exhausted approach without adding
an evidence identity, contrary to SC-11/AC-11.

Baseline: merged PLAN-172 tree
`305c0006e496cbae51076df306e2e6f027bb2d6f`.

## Minimal unit

1. Treat `newEvidence` as an explanation, not evidence identity.
2. Admit a repeated failed attempt only when the explanation is non-empty and
   the attempt introduces at least one reference not already recorded for the
   task. References are the normalized union of `evidence`, `validationRun` and
   `logRefs`.
3. Clear a blocking fingerprint-cycle gate through new evidence only when a
   later attempt satisfies the same explanation-plus-new-reference boundary.
4. Keep an accepted or resolved replan as the existing alternative gate.

This is a structural admission check. A reference remains subject to its owning
validation, research or log acceptance boundary; recording the reference here
does not make its claim true.

## Exclusions

- No semantic equivalence classifier for reworded hypotheses.
- No new evidence store, reviewer workflow or model call.
- No aggregate tactic/review budget or P5 completion claim.
- No retroactive rejection of persisted attempts that did not claim new
  evidence.

## Validation and commits

1. Add regressions for prose-only, reused-reference and fresh-reference retry
   admission, plus the corresponding cycle-gate behavior.
2. Implement one shared evidence-reference predicate for record and gate paths.
3. Document the bounded SC-11 improvement and keep SC-11/SC-15 Partial.
4. Run focused debug tests, build and the applicable exact-head gate before
   review.

## Independent-review closure

The first exact-tree review found three valid admission gaps. The cycle-forming
attempt can no longer clear its own gate: only a later persisted attempt may do
so. Debug-attempt admission and publication are serialized under one bounded,
non-stealing lock, so concurrent claims cannot both consume the same fresh
reference or overwrite the audit ledger. Malformed non-string legacy references
are ignored rather than granting admission or crashing the gate.

The second exact-tree review found that a cleared historical blocker could mask
a later cycle and that malformed reference containers could still throw or be
split into characters. The gate now tracks the latest unresolved blocker after
each evidence clearance, and only arrays are accepted for persisted `evidence`
and `logRefs` containers. A later cycle therefore re-closes admission, while
malformed containers fail closed.
