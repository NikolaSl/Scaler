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

Preserve exact code, contracts, identifiers and other exact material externally.
Summaries MUST cite source versions and distinguish observations from inference.
Compaction MUST preserve active constraints, unresolved questions, accepted
decisions, current failure and next action, with retrievable evidence.
Do not repeatedly summarize summaries when the source is available.

On missing input, retrieve/investigate within scope or block/replan. Do not fill
gaps with invented facts. Tool outputs and new retrievals pass the same envelope
check before they enter the next call.
