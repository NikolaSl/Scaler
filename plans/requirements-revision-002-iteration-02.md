# Requirements Revision 002 — Iteration 02

## Goal and boundary

Refine the existing proposal in PR #1 from the user's follow-up decisions:
bounded tactic changes, evidence-led diagnosis, independent checks of direction,
and prevention of invented requirements during planning and review. Address the
Copilot review of commit db65b75e48b830b8d0332dd9f3377cd9b3508011.
Keep the 27 SC IDs, proportional process, local-only support and sequential
workspace policy. Architecture, runtime changes and model benchmarks are deferred.

## Planned work

- [x] Read current requirements and fetch current PR/Copilot comments.
- [x] Refine existing specifications and catalog without a new agent hierarchy.
- [x] Extend acceptance scenarios and mark new behavior as unverified in coverage.
- [x] Fix both index mappings and clarify whole-run acceptance wording.
- [x] Check IDs, legacy mappings, links/anchors, index/header agreement and diff scope.
- [x] Prepare the checked documentation for publication in the existing PR branch.

## Validation boundary

Document integrity and focused legacy conformance checks establish consistency,
not runtime compliance. Record results after execution; no savings, bias
elimination or small-model success rate is claimed.

## Results

- This iteration changes 18 Markdown files; the complete PR changes 39.
- Integrity passed: 27 SC requirements, 27 AC sections, 27 coverage rows, all 49
  historical PRD IDs mapped, all 24 spec documents indexed with matching headers.
- All 214 relative Markdown links/anchors in the complete PR's changed files resolve.
- `git diff --check` passed; no runtime, dependency or test implementation changes.
- Focused legacy conformance tests: 5/5 passed. They do not certify SC behavior.
- Extended scenarios and reviewer metrics remain Not assessed; no model or
  runtime acceptance execution is claimed.
- Publication target: existing PR #1, branch `docs/requirements-v2`; no merge.
