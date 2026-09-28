# PLAN-172 — Separate liveness from evidenced progress

## Reproduced gap

The watchdog currently treats every `running` heartbeat and every parent
`turn_end` as progress by setting `lastProgressAt` to the event timestamp. A
worker can therefore remain active without producing decision-relevant evidence
and indefinitely postpone the configured no-progress stop. This contradicts
AC-15, which explicitly separates liveness from meaningful progress.

Baseline: merged P4 tree
`98c823372fc471369a068e8fb31a32ab0e853390`.

## Minimal unit

1. Treat `running` as liveness only. It retains the last evidenced progress time
   for the same scope instead of advancing it.
2. Admit `progress` only with a bounded structured record naming one allowed
   progress kind, a non-empty evidence reference set and a concise summary.
3. Stop labeling ordinary provider `turn_end` as progress. It remains a running
   heartbeat; provider usage continues through the existing budget ledger.
4. Base staleness on the latest active heartbeat's retained progress time, so
   repeated liveness cannot reset the no-progress limit while a genuine
   evidenced event can.

Allowed initial progress kinds are: accepted artifact, fixed reproducible
failure, ruled-out material hypothesis, retrieved missing fact, and completed
check resolving an open acceptance question. This is a structural admission
boundary; the referenced evidence remains subject to its owning acceptance
gate and is not made true by the watchdog record.

## Exclusions

- No semantic classifier, reviewer workflow or second-model call.
- No aggregate tactic/review budget, multi-scope scheduler or P5 completion
  claim.
- No inference that a new error, reworded hypothesis, plan rewrite, agent ID or
  repeated green check is progress.

## Validation and commits

1. Add regressions showing repeated `running` heartbeats and ordinary turns do
   not move the progress clock, while a valid evidenced progress record does.
2. Implement the smallest heartbeat contract and lifecycle-hook change.
3. Run focused watchdog/extension tests, build and the applicable exact-head
   gate; document SC-15 as still Partial.
