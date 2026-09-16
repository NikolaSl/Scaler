# Bounded Storage and Evidence Retention
Requirements: SC-19. Acceptance: AC-19.

## Core behavior

Bound runtime storage growth, output buffering and retrieval size. Check free
space and configured quotas before large writes and periodically in long runs.
Pause safely with cleanup options before storage exhaustion; do not discard
acceptance evidence to make progress look successful.

Distinguish disposable caches/temp data from active inputs, exact sources,
accepted outputs, audit evidence and recovery records.
Deletion MUST respect active references and retention policy. Do not delete
referenced evidence merely because its age exceeds a generic threshold.

## Optional mechanisms

Compression, deduplication, archival and scheduled maintenance MAY be enabled.
They must preserve content identity, index reachability and scoped retrieval.
Read/write large payloads incrementally; do not buffer an entire archive by default.

All managed cleanup stays within its declared resource scope. Evidence expiring
under authorized retention policy gets an explicit unavailable/tombstone record;
claims of current reproducibility or revalidation must reflect that limitation.

Retention defaults and overrides must be visible. Git history does not substitute
for storage of an external artifact referenced by that history.
