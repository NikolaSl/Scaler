# PLAN-136 — Exact TypeScript/JavaScript function context

## Status

Implemented on the P3 preparation branch; phase review and merge remain pending.

## Evidence and problem

SC-07/AC-07 requires exact retrieval of a requested function or section near
the end of a large file. PLAN-121 implements exact Markdown heading selection,
but the manifest schema accepts only `markdown-heading`; code falls back to a
prefix snippet or the whole file. The coverage matrix therefore correctly
leaves AST/function selectors open.

## Bounded objective

Add a `typescript-function` file-section selector for JavaScript and TypeScript
source files. It will:

1. use the TypeScript parser rather than regular expressions;
2. select one named top-level function declaration or one named top-level
   variable initialized with an arrow/function expression;
3. preserve the declaration's exact source bytes without rendering or rewrite;
4. fail closed on unsupported extensions, malformed source, missing or
   ambiguous names, non-identifier bindings and oversized selections;
5. round-trip and fingerprint the selector through the existing context-source
   freshness boundary;
6. keep required unavailable context blocking before dispatch.

TypeScript becomes an explicit runtime dependency because selection executes in
the installed extension, not only during tests.

## Test-first proof

- Put the selected function after a large unrelated prefix and assert that only
  the exact declaration is returned.
- Cover exported/async functions and callable `const` declarations.
- Reject duplicate, missing, oversized, malformed and unsupported-file cases.
- Round-trip both Markdown and function selectors in one manifest.
- Exercise one conductor dispatch with exact function context and one required
  refusal before runner invocation.

Run focused context/conductor tests after meaningful changes and the full build,
unit/component, mock-integration, conformance and diff gate on the candidate.

## Explicit boundaries

This unit does not select class methods, object properties, overload groups,
anonymous defaults, namespaces, re-exports, semantic symbols across files or
non-JavaScript languages. It does not implement automatic selector discovery or
automatic effective splitting, and therefore does not complete SC-07/AC-07.

## Implementation evidence

- `typescript-function` selectors use the TypeScript parser for `.ts`, `.tsx`,
  `.mts`, `.cts`, `.js`, `.jsx`, `.mjs` and `.cjs` files.
- A unique named top-level function declaration or single-declaration callable
  variable statement is returned as its original source substring. TypeScript
  is now an explicit runtime dependency.
- Missing, ambiguous, overloaded, nested/class, multi-binding, malformed,
  unsupported-extension and oversized cases return unavailable context.
- The selector round-trips through task manifests and durable task-attempt
  bindings, participates in the existing byte fingerprint, and is revalidated
  before dispatch and result acceptance.
- Conductor coverage proves exact prompt delivery and that unavailable required
  function context refuses before runner invocation, attempt publication or
  spawned-agent accounting.

The exact code head passed build, 1,082 unit/component tests, 67 mock integration
tests, 7 conformance/autopilot tests, 134 focused context/conductor/attempt tests
and `git diff --check`.
