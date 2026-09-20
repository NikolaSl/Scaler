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

1. Attach a deterministic source binding to each successfully resolved and
   actually included file-backed context item. Bind the normalized manifest
   path, scope, selector and a fingerprint of the complete source-file bytes
   used for resolution. Hash the original `Buffer` and render from that same
   single read; decoded UTF-8 text is not a byte identity. Inline, generated and
   budget-omitted context retain their existing behavior.
2. Include source bindings in the admitted input identity and persist the
   minimal revalidation descriptors with the durable task attempt. Do not rely
   on process-local state or a second best-effort cache.
3. Revalidate all admitted file bindings immediately before dispatch and again
   before accepting a returned worker report. A missing, unreadable, changed or
   newly ambiguous immutable source must fail closed with a task/item/path
   diagnostic. Preserve the descriptors outside the fixed-size prompt-facing
   attempt binding, while including them in the admitted input identity and
   comparing the durable descriptors with the originally admitted record.
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

### Review-driven ownership boundary

Changed-file discovery intentionally admits files under a task's allowed write
scope, and a worker may legitimately edit one of those files. Blanket
post-dispatch immutability would reject successful implementation and debug
repairs. Exempt post-dispatch drift only for an exact declared `outputPaths`
entry that also satisfies the task's existing write scope. Retain its initial
source binding and let the existing output snapshot, validation and acceptance
boundaries govern the changed result. Do not exempt a whole
`allowedPathPrefixes` subtree or infer intent from a broad path permission.

Pre-dispatch freshness still applies to every admitted file, including intended
outputs. New attempts explicitly persist `[]` when no file source was admitted.
Legacy terminal attempts remain readable, but missing source-binding coverage
on a legacy open attempt is not verified-empty evidence and must enter the
existing recovery/interruption path.

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
- a worker legitimately edits an admitted file that is both an exact declared
  output and inside its allowed write scope, while a merely allowed-prefix file
  remains freshness-bound.

Each drift case must prove that no returned task report, validation receipt,
completion evidence or successful attempt is accepted. Add a narrower race
fixture for change between initial resolution and dispatch. Run the focused
context, attempt-execution, conductor and debug-retry suites, followed by build,
the full unit suite, mock integration and conformance/autopilot gates.

Two independent GPT-6 Astra/high reviews must inspect the exact candidate head
and the adversarial selector cases before this unit is complete.

## Implemented result

File-backed context now carries a durable descriptor containing its normalized
manifest path, scope, selector, complete source-byte fingerprint and whether the
source is a direct regular project file eligible for the exact-output exception.
The descriptor participates in admitted input identity and is persisted on the
attempt. Admission, pre-dispatch and returned-report acceptance re-read the
source through a non-blocking file descriptor and reject missing, non-regular,
replaced or changed files before any successful result is persisted.

The post-dispatch exception is deliberately narrower than path authorization:
it applies only to an exact declared output whose initial source had no symlink
leaf or ancestor and was a direct regular project file. Symlink-backed output
context therefore cannot escape freshness checking by changing its referent.
Budget-omitted context does not retain a source binding and continues to be
excluded from admitted prompt identity.

Regression coverage includes the planned full-file, selected-section,
newly-ambiguous-section, deleted-source, unrelated-file, inline-only,
exact-output and allowed-prefix cases. Additional adversarial cases cover byte
identity, normalized paths, descriptor tampering, legacy open attempts, leaf
and ancestor symlinks, and FIFO replacement without blocking. Review findings
for symlink referent drift and FIFO hangs were reproduced and fixed in
`423b8c12f54af662fde0d113e9f14ced018f8290`.

Focused verification:

`node --test --import tsx test/context.test.ts test/attempt-execution.test.ts test/conductor.test.ts test/debug-retry.test.ts test/task-attempts.test.ts`

The merge candidate still requires the full build, unit, mock-integration and
conformance gate plus two clean independent exact-head reviews. PLAN-122 remains
a bounded filesystem freshness check, not authenticated file provenance or a
transactional snapshot.

## Explicit limits

This unit covers file-backed task-context manifest items only. It does not add
AST/function selectors, semantic search, embeddings, automatic task splitting,
provider usage reconciliation, remote-source validators or authenticated
filesystem writers. It does not claim real-model quality, token savings, scale
or deployment readiness. No P3 PR is opened until the prerequisite P2 phase PR
is reviewed and merged. Freshness reads are admission checks, not a filesystem
transaction: change-and-restore, a race after the final read, and attribution of
which process changed a task-owned output remain outside this unit.
