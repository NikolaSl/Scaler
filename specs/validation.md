# SCALER Validation Gates Spec

## Purpose

Validation gates decide whether task output is acceptable.

A task is not complete because an agent says it is complete. It is complete only when required validation gates pass and the supervisor accepts the validation report.

## Principle

Validation should be objective when possible and evidence-based when objective checks are not available.

Use the strongest practical validation for the task, but avoid wasteful validation cycles that do not increase confidence.

## Validation manifest

Each planned task should include a validation manifest:

- task id
- Definition of Done
- required validation gates
- validation commands/checks
- expected outputs/artifacts
- required evidence
- acceptance criteria
- optional validation gates
- known environment requirements

## Software validation gates

For software tasks, use these gates where applicable:

1. Dependency check — dependencies install/resolve and lockfiles are consistent.
2. Test-first check — unit tests are written/updated before implementation when practical.
3. Build/compile check — project or affected package builds/compiles.
4. Unit tests — relevant unit tests pass.
5. Integration tests — relevant integration tests pass or are updated when needed.
6. Static checks — lint/typecheck/format checks when available.
7. Security checks — dependency audit, container/image scan, or security scanner when relevant and available.
8. Local CI/CD environment checks — Docker, dev container, Compose, or Minikube validation when planned or useful.
9. Acceptance/smoke tests — run in local CI/CD environment or sandbox when available and useful.
10. Regression check — previously validated behavior remains passing where practical.

If a gate is not applicable or cannot run, the validation report must explain why.

## Test-first rule

For software implementation:

- Prefer writing or updating unit tests before implementation.
- When modifying existing behavior, update related tests first.
- If test-first is impractical, record the reason and define another validation path before implementation.

## Non-software intellectual validation gates

For non-software tasks, use evidence-based validation:

1. Completeness — output covers the requested scope and Definition of Done.
2. Consistency — no internal contradictions.
3. Compliance — follows PRD, constraints, standards, or policy.
4. Source validation — important claims are checked against reliable local or internet sources when possible.
5. Adversarial review — ask critical questions that try to invalidate the result.
6. Uncertainty report — unresolved assumptions, risks, and confidence level are stated.

## Validation execution order

Recommended order:

1. Run the smallest relevant validation first.
2. If it fails, enter debugging and rerun the exact failing validation after each attempt.
3. After the exact failure is fixed, run the full required validation set.
4. Store validation results and logs.
5. Commit validated task changes according to `specs/git-workflow.md` when applicable.
6. Submit validation report to supervisor.

## Validation report

A validation report should include:

- task id
- validation status: `passed`, `failed`, `partial`, `blocked`, `not_applicable`
- gates run
- commands/checks executed
- expected results
- actual results
- logs/artifact references
- skipped gates and reasons
- failures and fingerprints
- remaining risks
- recommendation: accept, debug, block, or replan

## Acceptance rules

The supervisor may accept task completion only when:

- all required gates passed, or skipped gates have accepted reasons
- Definition of Done is satisfied
- outputs/artifacts exist where required
- validation evidence is stored
- task commit is created or explicitly skipped according to git workflow rules
- no unresolved blocker affects the task result

## Failure behavior

If validation fails:

- task moves to debugging
- failure and attempt tracking rules apply
- exact failing validation becomes the primary debug target
- full validation is rerun only after the exact failure is resolved

## Security validation

Security-sensitive tasks and tasks that add/update dependencies, Docker images, third-party modules, auth, permissions, crypto, or deployment config should include security validation according to `specs/safety-permissions.md`.

Local CI/CD and deployment-like validation should follow `specs/cicd-environment.md`.

If CVE/security scanners are unavailable, the validation report must state the limitation and whether execution should pause, continue with risk, or add scanner setup to the plan.

## Environment limitations

If validation infrastructure is missing, the task should not silently pass.

The agent should either:

- create/update required validation environment if within task scope
- request missing dependencies/permissions
- mark the gate blocked with evidence
- escalate to replanning if the plan lacks necessary validation setup

## Logging

All validation commands, checks, results, skipped gates, and acceptance decisions must be logged according to `specs/logging.md`.

Large validation outputs should be stored by reference according to `specs/storage.md`.
