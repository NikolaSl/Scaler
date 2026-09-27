# PLAN-145 — P3 exact local module-import discovery

## Status

Implemented and validated on the P3 preparation branch; phase review and merge
remain pending.

## Observed prerequisite gap

PLAN-139 can discover a named JavaScript/TypeScript function across bounded
allowed paths, but the candidate pipeline cannot follow an explicit local
module edge to the referenced source file. Generic scoring may happen to expose
the file, yet it does not prove which parsed import/export declaration named it
and must not turn packages, aliases or unsafe filesystem paths into authority.

## Bounded unit

1. Recognize only an explicit `import:<specifier>` context-candidate query.
   Empty, whitespace-padded or non-relative specifiers fail closed rather than
   falling back to generic search.
2. Search the existing bounded allowed-path JavaScript/TypeScript source set and
   inspect only parser-backed static `import` and re-export declarations whose
   string-literal module specifier matches exactly.
3. Resolve only relative specifiers that explicitly name a supported source
   file. Require the normalized target to stay inside the workspace and task
   allowed paths, and revalidate both source and target through the existing
   stable direct regular-file reader.
4. Emit one path-bound snippet candidate per unique eligible target. Discovery
   remains read-only and the existing approval command remains the sole manifest
   mutation boundary.
5. Keep function, heading, Markdown-link and generic candidate discovery
   unchanged.

## Test-first evidence

- an exact static import discovers, approves and resolves its local target;
- repeated imports/re-exports to one target deduplicate while distinct eligible
  targets remain separate candidates;
- type-only imports and static re-exports use the same exact boundary;
- package, alias, dynamic import, `require`, extensionless, queried, fragmented,
  escaping, symlinked and unsupported targets are ineligible;
- unrelated changed files cannot starve the bounded allowed-path search;
- existing function, heading, Markdown-link and generic discovery retain their
  behavior.

Run focused context tests after meaningful changes, then the full TypeScript
build, unit/component, mock-integration, conformance/autopilot and diff gate on
the candidate.

## Explicit limits

This unit does not implement TypeScript/Node package resolution, `paths` aliases,
extension inference, dynamic imports, `require`, symbol/call-graph traversal,
recursive crawling, natural-language inference, automatic candidate approval,
task decomposition, model execution, quality or savings evidence. It adds one
explicit exact local-code bridge to the bounded/manual pipeline; SC-07/AC-07
remains Partial.

## Implementation evidence

- `test/context.test.ts` first reproduced three missing boundaries: exact target
  approval/resolution, repeated-edge deduplication with distinct targets, and
  refusal of non-static or unsafe specifiers (76 pass / 3 expected fail).
- `src/context.ts` recognizes only well-formed `import:<specifier>` queries,
  parses top-level static imports/re-exports with the TypeScript parser, and
  resolves extension-explicit relative targets through the existing bounded
  allowed-path and stable regular-file checks.
- Follow-up tests reject malformed source and symlinked target ancestors and
  prove unrelated changed files cannot starve allowed-path discovery.
- The exact-head candidate passes the TypeScript build, 1,134 unit/component
  tests, 67 mock integration tests, 7 conformance/autopilot tests, 81 focused
  context tests and `git diff --check`.
