# PLAN-100 — Tool execution ledger publication

Bounded prerequisite to PLAN-099 P2.2: requests, results and transactions used by
parallel tool execution must remain readable and retain every committed record.

## Scope and sequence

1. Reproduce torn reads with a large synthetic result while a reader loops, and
   lost records with concurrent request/transaction writers and separate processes.
2. Publish the three execution indexes by same-directory atomic replacement.
3. Serialize their complete read/modify/write boundaries using a short filesystem
   lock, independent of the execution lock. Keep waiting bounded and never steal
   a lock based on age. Do not hold it across model or tool execution.
4. Verify focused tests, TypeScript build and the full unit/mock integration gate.
   Request Copilot review of the final change before merging.

Preserve index schemas and public function signatures. This does not claim a
transaction across the three files, crash reconciliation of tool effects, shared
acceptance, or cross-process safety for schema/schedule/replay-approval ledgers.
Those remain separate work. No new database, dependency or service is needed.

## Fixtures and limits

- Two MiB synthetic outputs make reader overlap observable; bound the number of
  reads and writes rather than retrying until a lucky pass.
- Barrier-released child processes publish independent requests/results; assert
  all expected identities survive, not only that the JSON parses.
- Held publication lock must time out without modifying the committed files.
- Failed serialization/publication must preserve the previous index and release
  the live writer's lock. An orphaned lock requires manual reconciliation.

## Progress

- Planned after PR #3's current-head gate passed 508 unit and 67 mock tests in a
  fresh checkout. A fresh Copilot review of its final documentation commit is
  pending; no merge is inferred from the earlier no-comments review.
