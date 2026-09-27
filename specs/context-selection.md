# Context Admission and Focused Retrieval
Requirements: SC-05, SC-07. Acceptance: AC-05, AC-07.

## Complete envelope

Before EVERY model call, including retries and in-task turns, the adapter MUST
account for system instructions, task instructions, selected source material,
history, tool schemas/guidelines, injected hooks, pending tool results, protocol
overhead, reserved output and a safety margin.

The admitted envelope MUST fit both the configured task allowance and the
selected model's usable window. Prefer the model tokenizer; otherwise use a
declared conservative estimator and margin. Record estimate versus observed usage.
A fixed characters/4 estimate MUST NOT be represented as exact token measurement.

If the host does not expose complete accounting, report the limitation and use
a verified conservative bound or refuse strict-budget operation. A context-split
record alone does not make an unchanged oversized request admissible.

## Selection

Resolve current task criteria, constraints, relevant requirements, accepted
dependency outputs, requested source sections and validation needs immediately
before execution. Include only items with a task-specific reason.
The manifest MUST identify source/version, scope/selector, exactness, priority,
estimated size and validity. Large distant plans and full audit history are not
default model inputs.

A small initial context is a focus decision, not an information embargo. The
worker MUST have a scoped way to request additional required inputs by source,
selector or missing-data question. The supervisor resolves and validates that
request against task scope, source version, authority and relevance, then admits
the resulting exact material or bounded summary through the complete envelope
check before the next model call. It may externalize exact bytes and allow later
retrieval; a bare reference is useful only when the worker can actually resolve
it. Do not require the model to know an unavailable file path in advance: a
bounded candidate search or explicit missing-data question must be possible.

Required material MUST NOT bypass admission limits. If it does not fit:
retrieve a smaller sufficient exact scope, externalize with resolvable references,
summarize summary-permitted content, split the task, or use an authorized larger
envelope/model. Rebuild and recheck the final request. If none works, block it.
A bare reference is sufficient only when the task can proceed with on-demand
retrieval; it is not a substitute for unavailable required facts.

## Retrieval and compaction

Search returns bounded candidates with relevance reasons. Selection and retrieval
are separate operations; embeddings are optional.
A section request MUST retrieve that section, not the first N characters.
Missing/ambiguous sections, stale versions and truncation MUST be explicit.
An explicit local-document lookup may follow a parsed Markdown link only after
the rendered label, relative destination, workspace boundary, task path scope
and direct regular-file identity are verified. External URLs and links whose
query/fragment semantics are not implemented remain unavailable.
An explicit local-code lookup may follow a parsed static import or re-export
only when the exact relative specifier names a supported source extension and
both files pass the same workspace, task-path and direct regular-file checks.
Package/alias resolution and dynamic loading remain unavailable unless a later
adapter establishes their exact semantics.
An explicit imported-function lookup may additionally compose one such edge
with the exact TypeScript-function selector only when a static named import or
named re-export identifies the source name and the target contains one direct
exported top-level function or callable variable with that name. Default,
namespace and type-only bindings, indirect exports and recursive export/call
graph traversal remain unavailable.

Preserve exact code, contracts, identifiers and other exact material externally.
Summaries MUST cite source versions and distinguish observations from inference.
Compaction MUST preserve active constraints, unresolved questions, accepted
decisions, current failure and next action, with retrievable evidence.
Do not repeatedly summarize summaries when the source is available.

On missing input, retrieve/investigate within scope or block/replan. Do not fill
gaps with invented facts. Tool outputs and new retrievals pass the same envelope
check before they enter the next call.
The worker's `needs_data` or narrower-context proposal does not authorize a new
path or bypass the model window. Record the requested source/question, validated
scope, exactness and version, what was actually supplied, and a distinct
unavailable reason when retrieval cannot satisfy the requirement. An oversized
required input must trigger exact scoping, externalization, a justified split,
an eligible larger configured window or a truthful blocker, never silent removal.
