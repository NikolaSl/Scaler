# PLAN-151 — P3 missing-file request supplies the next attempt

## Status

Implemented on `implementation/v2-p3-proportional-routing`; PR #24 remains the
only PR in review. Validation and publication evidence are recorded below.

## Observed gap

`dispatchFileRequest` marks a `needs_data` file request resolved after reading
arbitrary source text and stores only a length-bearing summary. Unblocking the
task does not add the requested bytes to its context manifest. The next worker
can therefore run without the information it requested. The path read also does
not check task scope or direct regular-file identity at this boundary.

## Bounded unit

1. For an explicit task file request, require a workspace-relative regular file
   through direct non-symlink ancestors and a task-authorized path. Refuse an
   absent, escaping, protected, non-regular, symlinked or unauthorized source.
2. Add the exact requested file as required context in the existing task
   manifest before marking the request resolved. Resolve it through the existing
   stable file-context reader and refuse missing/unavailable bytes.
3. Unblock only after the required context is durable. On the next conductor
   attempt, use normal full-prompt admission and freshness checks. A file too
   large for the selected window may be split or blocked, never truncated into
   apparent sufficiency.
4. Preserve the existing non-file request flows. Unknown-path search, precise
   section inference and automatic task decomposition remain later units.

## Test-first cases

- a requested workspace file becomes a required manifest item, and a subsequent
  admitted task prompt includes its exact content;
- a large requested file does not bypass prompt admission;
- escape, absolute, protected, symlink ancestor/leaf and non-regular inputs are
  refused without resolution or task unblocking;
- a missing explicit file retains a visible blocker; a path-unknown request uses
  the existing bounded local-research path rather than guessing a source;
- retry is idempotent and does not duplicate the required item.

Run focused missing-context/conductor/context checks after implementation, then
the TypeScript build and full unit, mock-integration and conformance gate.

## Boundary and evidence

The explicit file request now persists a required exact full-file item before
resolution. Scope and direct regular-file checks precede the stable manifest
reader. The next task attempt uses the existing prompt admission, so the
requested bytes cannot disappear into a length-only summary. The 1 MiB retrieval
cap prevents this request path from reading arbitrarily large files; narrower
section selection and unknown-path candidate discovery remain separate work.
This is process validation, not a claim about any model's ability to identify
the correct source or solve the task.

Test-first: the prior implementation failed the required prompt and scope
regressions. The implementation passes the TypeScript build, 149 focused
missing-context/conductor/context tests, 1,156 unit/component, 68 mock
integration and 7 conformance/autopilot checks. The mock workflow initially
failed because its task allowed only `src` while requesting `docs/spec.md`;
the fixture now explicitly authorizes `docs` and asserts that the retried
worker prompt contains the requested bytes. `git diff --check` passes.
