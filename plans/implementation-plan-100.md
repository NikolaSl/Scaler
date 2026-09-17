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
- Failed serialization must preserve the previous result index and release
  the live writer's lock. An orphaned lock requires manual reconciliation.

## Progress

- Planned after PR #3's gate passed 508 unit and 67 mock tests in a fresh checkout.
- Before the repair, the five new regression tests produced four failures:
  parallel requests lost identities, the result reader raised `Unexpected end of
  JSON input`, independent workers lost requests, and a held lock was ignored.
  The serialization-failure control already passed. The fixture is synthetic
  and makes no model/provider calls.
- The repair preserves the three schemas and API signatures. A local queue plus
  a filesystem publication lock encloses each complete read/modify/write; atomic
  replacement keeps unlocked readers on complete snapshots. Contention across
  processes is bounded to two seconds. Lock age never transfers ownership.
- Focused regression/tool checks: 34/34 passed. Full build and gate: 513/513 unit
  and 67/67 mock integration tests passed. No test assertions were weakened. No
  real-model test was rerun for this filesystem-only change.
- Copilot's PR #3 scheduling comment was valid and corrected on its own branch;
  its publication protocol is unchanged. This unit still requires its own
  completed review and fresh head/check verification before merge.

## Handoff

After the ledger PR is reviewed and merged, continue PLAN-099 P2.2: inventory
task report, validation, conductor and acceptance entry points; define the small
attempt/input/output/policy identity contract before changing acceptance paths.
Do not treat this repair as completion of P2.2, P2.3 or SC-13. In particular, a
request status can publish before its result; interruptions and external effects
still require explicit reconciliation, never automatic tool replay.
