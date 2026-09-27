# PLAN-144 — P3 exact local Markdown-link discovery

## Status

Planned on the P3 preparation branch; implementation, validation, phase review
and merge remain pending.

## Observed prerequisite gap

PLAN-139 and PLAN-140 can discover an exact function or heading when its name is
known, but they cannot follow a local document link to the referenced file.
Generic candidate scoring may expose a source snippet, yet does not prove the
destination identity and must not turn external, escaping or malformed links
into file authority.

## Bounded unit

1. Recognize only an explicit `link:<label>` context-candidate query. Empty or
   whitespace-only labels fail closed rather than falling back to fuzzy search.
2. Search the existing bounded allowed-path Markdown source set and inspect its
   CommonMark link nodes. Match the rendered link label exactly.
3. Accept only relative, local file destinations without a scheme, query or
   fragment. Resolve them relative to the source document, require the resolved
   target to stay in the workspace and task allowed paths, and revalidate it
   through the existing stable regular-file reader.
4. Emit a path-bound snippet candidate for each unique eligible target. Listing
   remains read-only and the existing approval command remains the only manifest
   mutation boundary.
5. Keep function, heading and generic candidate discovery unchanged.

## Test-first evidence

- an exact link-label query discovers, approves and resolves one local target;
- relative `../` destinations may normalize within allowed paths but cannot
  escape the workspace or task path boundary;
- external URLs, absolute paths, query/fragment destinations, symlinks,
  non-files and unsupported targets are ineligible;
- fenced pseudo-links and nonmatching labels are ignored;
- repeated references to one target deduplicate, while distinct eligible
  targets remain separate candidates;
- unrelated changed files cannot starve the bounded allowed-path search;
- function, heading and generic candidate discovery retain their behavior.

Run focused context and command tests after meaningful changes, then the full
build, unit/component, mock-integration, conformance/autopilot and diff gate on
the candidate.

## Explicit limits

This unit does not infer a link label from task prose, follow external URLs,
interpret anchor semantics, recursively crawl documents, select or approve a
candidate automatically, resolve code imports/call graphs, decompose a task,
configure a model, or prove quality or savings. It adds one explicit exact
local-document bridge to the existing bounded/manual pipeline; SC-07/AC-07
remains Partial.
