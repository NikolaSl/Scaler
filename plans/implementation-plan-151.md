# PLAN-151 — P3 missing-file request supplies the next attempt

## Status

Preparation on `implementation/v2-p3-proportional-routing`; PR #24 remains the
only PR in review.

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
- missing file and no explicit path retain a visible blocker;
- retry is idempotent and does not duplicate the required item.

Run focused missing-context/conductor/context checks after implementation, then
the TypeScript build and full unit, mock-integration and conformance gate.
