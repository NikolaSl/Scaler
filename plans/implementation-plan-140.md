# PLAN-140 — P3 exact Markdown-heading selector discovery

## Status

Implemented on the P3 preparation branch; final exact-head validation, phase
review and merge remain pending.

## Observed prerequisite gap

PLAN-139 can discover an existing exact function selector when the operator
knows the symbol but not its file. The other exact selector supported by the
context resolver still requires both a Markdown path and heading in advance.
Generic candidate search only returns snippets and cannot safely convert a
heading-like query into an exact section selector.

## Bounded unit

1. Recognize only an explicit `heading:<text>` context-candidate query. Empty
   heading queries fail closed instead of degrading into fuzzy candidate search.
2. Search the bounded allowed-path candidate set introduced by PLAN-139 and
   inspect only Markdown files. Emit a candidate only when the existing exact
   CommonMark-backed selector can retrieve one unique, within-limit heading.
3. Return one path-bound `section` candidate per exact match. Candidate listing
   stays read-only and the existing approval command remains the only manifest
   mutation boundary.
4. Preserve exact path and selector identity through formatting, approval,
   deduplication and normal manifest resolution. Same-named headings in separate
   files remain separate candidates; duplicate headings in one file are
   ineligible rather than selected approximately.
5. Keep PLAN-139 function discovery and generic semantic discovery unchanged.

## Test-first evidence

- an exact heading query discovers and approves one matching Markdown section;
- approved resolution preserves the exact selected source bytes and excludes
  the following peer section;
- the same heading in two allowed files yields separate path-bound candidates;
- empty queries, duplicate headings, fenced pseudo-headings, unsupported file
  extensions and oversized sections yield no approvable candidate;
- unrelated changed files neither escape allowed paths nor starve an eligible
  Markdown target;
- function-selector and generic candidate discovery retain their prior behavior.

Run focused context and command tests after each meaningful change, then the
full build, unit/component, mock-integration, conformance/autopilot and diff
gate on the candidate.

## Explicit limits

This unit does not infer headings from task prose, perform fuzzy or cross-file
semantic selection, follow document links, choose or approve a candidate,
decompose a task, configure a model, or prove quality or savings. It adds only
explicit exact-name discovery for the already supported Markdown selector;
automatic selector choice and broader semantic lookup remain open, so
SC-07/AC-07 stays Partial.

## Implementation evidence

- `test/context.test.ts` first reproduced four failures for exact approval and
  bytes, cross-file ambiguity, malformed/ineligible input and changed-file
  starvation.
- `src/context.ts` recognizes only explicit `heading:<text>` queries, searches
  the bounded allowed-path set, and delegates eligibility to the existing exact
  CommonMark-backed section resolver.
- Candidate identity hashes the complete path and raw heading before readable
  suffixes, preserving separate choices through listing and approval.
- Focused context validation passes 71/71 checks; final aggregate gate evidence
  is recorded after the exact-head run.
