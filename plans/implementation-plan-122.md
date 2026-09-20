# PLAN-122 — P3 file-context source freshness binding

## Observed acceptance gap

`resolveTaskContextManifest` reads file-backed context once and places only the
resolved `ContextItem` content in the admitted input fingerprint. The durable
task-attempt record retains that aggregate fingerprint, but it does not retain
enough source identity to re-read a file. `checkTaskExecutionResult` therefore
checks the run, task, attempt, task contract and validation policy while never
checking whether an admitted file source changed during the worker attempt.

This is distinct from PLAN-121 exact-section selection. A worker can receive
the exact selected section, then return after the underlying file has changed.
The current result path can still accept that report as if its context were
current. Hashing only the selected substring would also miss changes that make
the selector ambiguous, such as adding a duplicate heading elsewhere in the
same Markdown file.

## Bounded unit

1. Attach a deterministic source binding to each successfully resolved
   file-backed context item. Bind the normalized manifest path, scope, selector
   and the complete source-file bytes used for resolution. Inline and generated
   context retain their existing behavior.
2. Include source bindings in the admitted input identity and persist the
   minimal revalidation descriptors with the durable task attempt. Do not rely
   on process-local state or a second best-effort cache.
3. Revalidate all admitted file bindings immediately before dispatch and again
   before accepting a returned worker report. A missing, unreadable, changed or
   newly ambiguous source must fail closed with a task/item/path diagnostic.
4. Reject freshness drift before report persistence, validation accounting,
   completion evidence or successful attempt closure. Preserve the interrupted
   attempt as auditable unknown/failed work through the existing interruption
   path.
5. Keep the existing prompt/provider admission checks authoritative for request
   size. Freshness binding must not re-render, silently truncate or substitute
   content after the request has been admitted.

The complete source bytes are intentionally bound even for a selected section.
That conservative first rule catches selector-semantic changes outside the
selected substring. A later optimization may prove a smaller equivalent source
identity, but this unit must not assume one.

## Test-first evidence

Add conductor and debug-retry fixtures whose runner mutates a file after it has
received the prompt but before returning a valid structured report:

- a full-file source changes while the selected prompt text remains in memory;
- a selected Markdown section changes;
- a duplicate matching heading is inserted elsewhere while the originally
  selected substring is byte-identical;
- the source is deleted or becomes unreadable;
- an unrelated file that was not admitted changes as a negative control;
- inline-only context remains compatible.

Each drift case must prove that no returned task report, validation receipt,
completion evidence or successful attempt is accepted. Add a narrower race
fixture for change between initial resolution and dispatch. Run the focused
context, attempt-execution, conductor and debug-retry suites, followed by build,
the full unit suite, mock integration and conformance/autopilot gates.

Two independent GPT-6 Astra/high reviews must inspect the exact candidate head
and the adversarial selector cases before this unit is complete.

## Explicit limits

This unit covers file-backed task-context manifest items only. It does not add
AST/function selectors, semantic search, embeddings, automatic task splitting,
provider usage reconciliation, remote-source validators or authenticated
filesystem writers. It does not claim real-model quality, token savings, scale
or deployment readiness. No P3 PR is opened until the prerequisite P2 phase PR
is reviewed and merged.
