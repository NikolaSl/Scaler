# Debugging and Retry Control

SCALER debugging is structured, evidence-based, and loop-resistant.

Artifacts:

- `.scaler/debug/failures.json` — failure fingerprints and validation failure summaries.
- `.scaler/debug/attempts.json` — attempted fixes/investigations with hypotheses, signatures, results, evidence, and resulting fingerprints.
- `.scaler/debug/reports.json` — debug-agent conclusions and escalation decisions.
- `.scaler/reports/debug-agent-runs.json` — focused debug-agent preparation/execution records.

## Attempt gate

`scaler_debug_attempt` records debug attempts. SCALER rejects duplicate failed attempts with the same signature and resulting fingerprint unless `newEvidence` is supplied.

The conductor checks a debug retry gate before preparing or executing a task. It refuses unresolved repeated failed fingerprints, blocked debug attempts, or detected fingerprint cycles until one of these clears the gate:

- a later accepted debug attempt includes `newEvidence`, or
- the related debug replan request is accepted/resolved.

Cycle detection includes direct A→B→A loops and longer hidden chains such as A→B→C→A.

## Debug agent

Commands:

```text
/scaler-validate-loop [taskId] [execute] [max=N]
/scaler-debug-run [taskId] [execute]
/scaler-debug-loop [taskId] [execute] [max=N]
/scaler-debug-runs [taskId]
/scaler-debug-reports
```

`/scaler-debug-run` prepares a focused debug-agent prompt for a selected debugging task. Passing `execute` runs the subprocess under the repo-wide execution lock and ingests only a valid structured `scaler_debug_report` JSON event.

The debug agent is instructed to:

1. inspect the exact failure, compact attempt stack, and detected cycles;
2. avoid the same failed/cyclic approach;
3. propose the next most probable untried evidence-backed approach when one exists;
4. request local/mixed/internet research when evidence is insufficient;
5. request replanning only when realistic debug/research paths are exhausted or the task/plan is wrong.

Accepted child JSON event shape:

```json
{
  "type": "scaler_debug_report",
  "taskId": "T-001",
  "status": "next_approach",
  "summary": "Root cause appears to be the shared adapter.",
  "failureId": "F-001",
  "failureFingerprint": "adapter import failure",
  "cycleSummary": "failure-a -> failure-b -> failure-a",
  "attemptedApproaches": ["Changed individual call site", "Reverted shim"],
  "investigationSummary": "Local tests show both failures pass through the adapter.",
  "rootCause": "Adapter maps the new API shape incorrectly.",
  "nextApproach": "Patch the shared adapter and rerun the exact failing test.",
  "evidenceRefs": ["debug-log-1"]
}
```

Statuses:

- `next_approach` — stores a concrete evidence-backed next approach; requires `nextApproach`.
- `needs_research` — creates research requests from `researchQuestions`; `researchScope` may be `local`, `mixed`, or `internet`.
- `needs_replan` — creates a debug-blocked replan request after debug/research exhaustion or plan/task invalidation.
- `blocked` — creates a debug-blocked replan request for an immediate supervisor-level blocker.

## Bounded debug conductor

`/scaler-validate-loop [taskId] [execute] [max=N]` runs validation, reloads the persisted state, and starts the bounded debug conductor only when validation fails the task into `debugging`. It avoids nested execution locks by running the debug loop after validation returns.

`/scaler-debug-loop [taskId] [execute] [max=N]` automates the current debug-agent/research-agent/replanner-agent handoffs for one debugging task. It is deterministic and bounded:

1. If a task-local debug-cycle/debug-blocked replan request is open, it runs the replanner agent and stops after a proposed plan is staged.
2. Else if a task-local research request is open, it runs the research agent and then re-evaluates the debug task.
3. Else it runs the debug agent.

The loop stops on prepare-mode handoff, rejected structured ingestion, `next_approach`, proposed replan generation, no debugging task, or max steps. It never accepts a proposed plan automatically; `/scaler-replan-accept` remains the preservation-gated current-plan replacement path.

## Current limitations

The bounded debug conductor does not yet implement automatic code patch/retry after `next_approach`. Use `/scaler-validate-loop` when you want validation to explicitly hand off into the bounded debug loop; plain `/scaler-validate` remains validation-only. Internet research still depends on explicitly granted tools and safety policy.
