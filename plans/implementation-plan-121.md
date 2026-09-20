# PLAN-121 — P3 exact Markdown-section retrieval

## Reproduced defect

The current task context manifest supports `scope: "section"` but has no section
selector. File resolution treats that scope as the first 3,200 characters and
then labels the result exact. A conductor fixture placed the required
`## Target` contract near the end of a 72,130-character Markdown file:

- `scope: "full"` was correctly refused at roughly 18,998/8,000 prompt tokens;
- `scope: "section"` dispatched a worker with an unrelated prefix, omitted the
  Target contract, and still reported exactness `"exact"`;
- encoding the selector in the scope string was rejected by manifest validation.

This makes the request fit by substituting the wrong content. PLAN-119 and
PLAN-120 correctly admit the resulting smaller payload but cannot detect the
semantic omission.

## Bounded unit

1. Add an explicit selector for file-backed Markdown headings while retaining
   the existing `"section"` scope. Do not infer selectors from free-text reason.
2. Extract the unique selected heading and its complete section, including
   subsections, stopping before the next heading of equal or higher level.
3. Preserve the exact source substring and line endings. Ignore heading-like
   text inside fenced code.
4. Fail closed before worker/attempt/spawn side effects when a required selector
   is missing, absent, ambiguous or exceeds the bounded retrieval allowance.
   Never truncate a required section while describing it as exact.
5. Preserve selectors through manifest save/load and approved candidate
   conversion. Compare file path plus selector for duplicate detection so two
   approved sections from one file remain distinct.
6. Reuse the existing prompt and strict provider admission boundaries after
   retrieval; successful selection must reduce the actual dispatched request.

## Test-first evidence

Use a conductor fixture with a large unrelated prefix, fenced pseudo-heading,
the unique Target section near the end, a nested subsection and a following
peer section. Before the fix, the worker sees the wrong prefix. After the fix,
it sees the exact Target source substring, including the nested subsection, and
sees neither the unrelated prefix nor the following peer section.

Negative controls cover a missing selector, missing heading, duplicate heading
and oversized selected section. Each must block without runner, attempt, task
transition or spawned-agent budget side effects. Additional controls cover CRLF
preservation and two distinct selected sections from one file.

Run the focused context/conductor suites, then build, the full unit suite, mock
integration and conformance/autopilot gates. Obtain two independent GPT-6
Astra/high exact-head reviews before treating the unit as complete.

## Explicit limits

### Review-driven implementation revision (2026-09-19)

Independent exact-head review reproduced two additional false exact selections:
a blockquote ending a list left a phantom list container, and an ordered marker
other than `1` incorrectly interrupted a paragraph. Both exposed a fenced
pseudo-heading as available. The new two-case regression fails on the previous
implementation. Earlier fixes already covered nested/lazy/tab list containers;
another partial block parser would repeat the same class of error.

The first replacement used the existing transitive `marked` 18.0.5 block lexer.
Independent reviews then reproduced four library-boundary defects: missed
tab-suffixed fence closers, mixed-character false closers, vertical-tab pseudo
headings, and omitted duplicate reference tokens. All four were captured as
failing tests; this intermediate implementation is not the final candidate.

Use pinned `commonmark` 0.31.2, the CommonMark reference parser, and its block
source positions instead. Select document-level ATX headings only, not headings
inside list, blockquote, code or HTML blocks. Setext headings are not selectable
but bound preceding sections. Map source line numbers to original UTF-16 offsets
across CRLF, CR and LF; never render HTML or return rewritten parser content.
Each parse uses a fresh parser. All previous regressions remain in the suite.
Reference: https://github.com/commonmark/commonmark.js (Node sourcepos API).

This unit supports exact Markdown ATX-heading selection only. It does not add
AST/function retrieval, semantic selector inference, embeddings, summaries,
automatic task splitting, model escalation or a second provider API. Fresh
context handoff and provider-backed compaction routes remain separate admission
work. No real model request, paid provider call or deployment is authorized.

## Result

Implemented on the P3 phase branch with separate plan, failing reproduction,
implementation and boundary-test commits. File manifests now carry an explicit
Markdown-heading selector. Retrieval preserves the exact substring and line
endings, includes nested headings, ignores fenced pseudo-headings and stops at
the next peer/ancestor. Missing selectors/headings, ambiguous matches and
oversized sections become structured unavailable context. Required unavailable
context refuses conductor and debug-retry dispatch before attempt, state or
spawn-budget side effects.

The reproduced 72k-character conductor fixture now dispatches the exact Target
section rather than the unrelated 3,200-character prefix. Build, 833 unit, 67
mock integration and 7 conformance/autopilot checks pass; the focused
context/conductor/debug set passes 70/70. Independent exact-head review remains
required before this bounded unit is treated as complete.

### Final implementation validation (2026-09-19)

Candidate `9d09da77f4abe71bb7f840b2a97484ed376a2654` (local `435b8d4`;
tree `d082b4b1db0534bed06ea8ef17bb506d18bc2e89`) passes TypeScript build,
862 unit, 67 mock integration, 7 conformance and 99 focused context/conductor/
debug-retry tests. All reproduced parser/library failures are fixed without
removing earlier assertions. The new source-offset fixture initially failed
because adjacent `Detail` and `Next` formed a multiline Setext heading; the
fixture now explicitly separates those paragraphs. No production code was
relaxed to satisfy that mistaken expectation. These are deterministic fixtures,
not real-provider quality or tokenizer savings evidence.

One final review finding showed Unicode trim collapsed distinct raw titles;
three regressions now preserve NBSP/narrow-NBSP, including whitespace-only
Unicode titles, through save/load and extraction. Both independent GPT-6
Astra/high reviews inspected exact local `435b8d4` and reported no remaining
finding. Reviewer A additionally exercised 729 mixed-line-ending cases and
99 focused tests; reviewer B exercised 81 independent in-memory cases. These
reviews cover the bounded implementation, not full P3 requirement completion.

Remaining delivery work: reconcile the dependent phase branches with merged
PR #21, and review/merge remaining P2 before
the coherent P3 PR. No small PLAN-121 PR is opened. Broader source freshness,
non-Markdown selectors and effective task splitting remain outside this unit.
