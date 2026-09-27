# PLAN-139 — P3 exact function-selector discovery

## Status

Implemented on the P3 preparation branch; final phase review and merge remain
pending.

## Observed prerequisite gap

PLAN-136 can retrieve one explicitly named top-level JavaScript/TypeScript
function when the manifest already contains both its path and selector. Context
candidate discovery only returns whole-file snippets, so an operator who knows
the required symbol but not its file cannot discover the existing exact
selector without manually searching the repository.

## Bounded unit

1. Recognize only an explicit `function:<identifier>` context-candidate query.
   Reject malformed selector queries rather than degrading them into fuzzy text
   search.
2. Search the same bounded changed/allowed-path file set already used by context
   discovery. Parse only supported JavaScript/TypeScript files and emit a
   candidate only when the existing exact selector can retrieve one unique,
   non-malformed, within-limit top-level callable declaration.
3. Return one path-bound `section` candidate per exact match. Keep candidate
   listing read-only and require the existing explicit approval command before
   persisting anything in the task manifest.
4. Preserve exact selector identity through formatting, approval, deduplication
   and normal manifest resolution. Multiple files with the same symbol remain
   separate candidates; discovery never chooses between them.
5. Keep the existing generic semantic candidate query unchanged when the query
   is not a function-selector query.

## Test-first evidence

- an exact function query discovers the matching declaration without returning
  unrelated whole-file candidates;
- approval persists the path plus `typescript-function` selector and exact
  section scope, then resolves only the selected source bytes;
- the same symbol in two allowed files yields two independently identifiable
  candidates and no automatic selection;
- malformed queries, unsupported extensions, malformed source, class methods,
  overload/duplicate declarations and oversized functions do not produce an
  approvable selector candidate;
- changed files outside allowed task paths do not become selector candidates;
- generic context discovery retains its prior behavior.

Run focused context and command tests after each meaningful change, then the
full build, unit/component, mock-integration, conformance/autopilot and diff
gate on the candidate.

## Explicit limits

This unit does not infer a symbol from natural language, follow imports or call
graphs, resolve methods/members/re-exports, authorize a candidate automatically,
decompose a task, configure a model, or prove quality or savings. It adds
bounded exact-name discovery over already allowed files; broader semantic
lookup and automatic selector choice remain open, so SC-07/AC-07 stays Partial.

## Implementation evidence

- Exact function queries bypass generic fuzzy candidates and emit only selectors
  that the existing parser-backed resolver can retrieve within its size bound.
- Candidate ids bind the complete path plus symbol identity, while approval
  persists the path, section scope and selector and normal resolution preserves
  the selected source bytes.
- Allowed-path filtering precedes the global candidate limit, so unrelated
  changed files cannot hide an eligible symbol or become selector candidates.
- Malformed query syntax, source errors, duplicate/overload declarations,
  class methods, unsupported extensions and oversized sections yield no
  approvable candidate. Same-named matches in separate files remain separate.
- The candidate passed the TypeScript build, 1,112 unit/component tests, 67
  mock integration tests, 7 conformance/autopilot tests, 67 focused context
  checks and `git diff --check`.
