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
