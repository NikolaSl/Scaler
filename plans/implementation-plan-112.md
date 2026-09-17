# PLAN-112 — Carry declared outputs from planning to validation

## Basis and scope

Continue P2.3 after PLAN-111. The manifest tool can declare outputs, but ordinary
execution-plan application and task create/update inputs cannot carry that
declaration. This forces a separate setup step and risks discovering missing
coverage only at completion. Add optional outputPaths to these existing
structured inputs and persist it in the validation manifest before dispatch.
Do not duplicate it in task state or introduce a second source of truth.

Keep omitted and [] distinct: omission preserves an existing declaration;
[] explicitly declares no filesystem outputs. Supplying paths without new
commands must retain the current/default commands. Replacing commands preserves
the declaration unless the caller explicitly replaces it. Accepted tasks still
reject metadata changes through the existing admission rule. Manifest/policy
changes invalidate evidence; this is transport, not permission to weaken policy.

Validate exact path shape before plan publication or task/manifest mutation.
Use the existing normalizer. The positional CLI remains compatible; callers
can use the manifest tool for declarations instead of another positional field.

## Ordered work

1. Commit this plan. Reproduce lost declarations through plan application,
   direct task APIs and registered create/update/planning tools.
2. Extend typed inputs/schema/normalization and existing manifest persistence.
   Preserve commands, explicit empty sets, accepted-task restrictions and state
   on invalid declarations. Add narrow regression/positive controls.
3. Run affected tests, build, full unit/mock integration and conformance.
4. Separate implementation and evidence commits; completed Copilot review on
   the tested final head before dependency-ordered expected-head merge.

Next: per-task commit-skip admission with missing output declarations. Declared
coverage adequacy/authority and semantic/final integration acceptance remain
open; no model call, deployment, new verifier framework or P2.3 completion claim.
