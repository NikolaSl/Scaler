# PLAN-190 — Configured direction decision before dependent dispatch

Compose PLAN-186's existing objective decision acceptance with the conductor's
existing dependency/evidence guards. A configured consequential task explicitly
depends on that decision. Test refused dispatch before decision acceptance,
after a failed/blocked decision, and after accepted output or constraint-source
mutation. Restoring the exact accepted basis must allow one downstream runner
invocation. The runner deliberately returns failure: this proves admission only,
not successful work, provider behavior or a real consequential external effect.

Extend the existing three-case fixture rather than add a duplicated harness or
production preflight subsystem. Keep green technical shape versus failed local-
only constraint, repair only the candidate, and preserve receipt freshness checks.
The dependency and explicit constraint are fixture-configured, not inferred risk
triggers or semantic interpretation. This narrows PLAN-186's missing downstream
dispatch evidence; it does not prevent arbitrary filesystem effects or establish
automatic risk selection, every public route, local inference or full SC-04/P5.
Missing mandatory prerequisites cannot become successful acceptance.

Focused scenario and conductor checks, build, full unit/mock/conformance gate,
own review and fresh independent exact-head review precede merge. No production
change is planned unless a concrete supported-route counterexample requires it.

The first fixture ordering incorrectly expected byte restoration to erase a newer
blocked validation report. The existing latest-evidence guard correctly refused.
Keep that validation-basis control, but run it after the restored-basis dispatch
positive control. No production regression or bypass is inferred from this setup
correction; returning a failed downstream runner is still deliberate.
