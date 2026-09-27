# PLAN-146 — P3 exact imported-function discovery

## Status

Implemented and validated on the P3 preparation branch; phase review and merge
remain pending.

## Observed prerequisite gap

PLAN-145 can follow an explicit local static module edge, and PLAN-139 can
discover a named function across all bounded allowed paths. The two boundaries
are not composed: a caller cannot explicitly name both the local edge and the
exported callable that it needs, so approval either selects the whole target
file or falls back to a workspace-wide same-name search.

## Bounded unit

1. Recognize only an explicit
   `import-function:<specifier>#<exportedIdentifier>` candidate query. Empty,
   whitespace-padded, malformed, non-relative or extensionless parts fail
   closed without falling back to generic search.
2. Search the existing bounded allowed-path JavaScript/TypeScript source set
   and inspect only parser-backed, top-level static named imports or named
   re-exports whose string-literal module specifier and imported/exported source
   name match the query exactly. Default, namespace, type-only and dynamic edges
   are outside this unit.
3. Resolve the extension-explicit relative target through PLAN-145's workspace,
   task-path and stable direct regular-file boundary. Require the target to
   contain one direct exported top-level function or callable variable with the
   exact source name, verified through the existing `typescript-function`
   selector.
4. Emit one path-and-selector-bound section candidate per unique eligible
   target. Discovery remains read-only and the existing approval command is the
   only manifest mutation boundary.
5. Keep whole-module import, function, heading, Markdown-link and generic
   candidate discovery unchanged.

## Test-first evidence

- an exact named import discovers, approves and resolves only the exported
  callable bytes from its target;
- named aliases and named re-exports bind the source export name, repeated
  eligible edges deduplicate, and distinct targets remain separate choices;
- missing/non-exported/non-callable/ambiguous target declarations fail closed;
- empty, padded, malformed, default, namespace, type-only, dynamic, package,
  alias, extensionless, queried, fragmented, escaping and symlinked edges are
  ineligible;
- unrelated changed files cannot starve the bounded allowed-path search;
- existing candidate modes retain their behavior.

Run focused context tests after meaningful changes, then the full TypeScript
build, unit/component, mock-integration, conformance/autopilot and diff gate on
the candidate.

## Explicit limits

This unit does not implement TypeScript/Node package resolution, `paths`
aliases, extension inference, default or namespace export semantics, export
star, recursive re-export traversal, dynamic imports, `require`, call-graph
traversal, natural-language inference, automatic candidate approval, task
decomposition, model execution, quality or savings evidence. It composes one
explicit static edge with one exact existing selector; SC-07/AC-07 remains
Partial.

## Implementation evidence

- `test/context.test.ts` first reproduced exact named-import approval,
  named-import/re-export deduplication with distinct targets, and fail-closed
  malformed/ineligible boundaries (81 pass / 3 expected fail before
  implementation).
- `src/context.ts` recognizes only well-formed
  `import-function:<specifier>#<identifier>` queries, verifies one exact static
  named import/re-export edge, requires one direct exported callable in the
  stable target bytes, and emits a path-and-selector-bound manual candidate.
- Follow-up tests reject malformed and type-only bindings, indirect/non-direct
  target exports, symlinked ancestors and multiple separators, and prove that
  unrelated changed files cannot starve discovery.
- The exact-head candidate passes the TypeScript build, 1,139 unit/component
  tests, 67 mock integration tests, 7 conformance/autopilot tests, 86 focused
  context tests and `git diff --check`.
