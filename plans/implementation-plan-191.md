# PLAN-191 — Explicit prerequisite authority before first validation

PLAN-190 proves configured dependency/evidence guards while the prerequisite
remains present. Reassess model task updates before adding risk machinery.
`reviewTaskAcceptancePolicyMutation` protects the full task contract only after
that task has a validation run. A user-command-created, unexercised task can
therefore lose its explicit decision dependency through a model update, even
while its user-established validation manifest remains protected.

Reproduce with DECISION blocked and USE ready, created through `createTask` with
`acceptanceAuthority: user_command` and `dependsOn: [DECISION]`. First show normal
conductor selection refuses dispatch. Then model `updateTask` with an empty
dependency list must not silently discard that explicitly configured prerequisite.
Test both update refusal/preservation and zero runner calls afterward. A failed
injected runner witnesses dispatch only; no real external effect or model call.
Keep model-owned draft and ordinary user-authored dependency simplification
controls plus an explicit user update control: blanket freezing of dependencies
on every user-authored task would obstruct legitimate replanning.

This is regression preparation, not an accepted fix. No red candidate may merge.
The current task/manifest contracts do not separately identify a mandatory
acceptance prerequisite versus an ordinary editable dependency. Before a minimal
fix, determine how to preserve the original user-authorized prerequisite basis
using existing validation-policy authority/versioning, without inferring authority
from every current dependency or adding a generic risk/review framework. Initial
dependency omission and semantic necessity remain distinct gaps. Any protected
prerequisite designation must be explicit trusted semantic input, not inferred
from every `dependsOn` supplied by `user_command`. Original wording/DoD identify
the mandatory case in this fixture; the baseline API has no separate designation.
Defining an explicit protected-prerequisite contract would be an implementation
step, not a claim that this baseline already exposes that interface. Do not pretend
that a gate label, user-owned unrelated command or model agreement proves them.

Focused RED reproduction, positive controls and independent review of the exact
preparation head are evidence, not a full gate or phase acceptance. The eventual
fix needs own full exact-head gate and fresh independent review before its PR.

Positive controls compare normalized empty dependencies (`undefined` and `[]`
both mean no dependencies), not an unsupported storage representation. The first
probe's representation-only control failures are not production regressions.

Independent review accepted the explicit original-request/DoD counterexample but
found that the first two positive controls would allow overbroad freezing of all
user-authored dependencies. Added the ordinary user-authored control and removed
the mandatory wording from both simplification controls. Do not implement the
rejected actor-plus-dependency inference shortcut.
