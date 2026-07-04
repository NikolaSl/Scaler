# Debugging and Retry Control

SCALER debugging is structured, evidence-based, and loop-resistant.

Artifacts:

- `.scaler/debug/failures.json` — failure fingerprints and validation failure summaries.
- `.scaler/debug/attempts.json` — attempted fixes/investigations with hypotheses, signatures, results, evidence, and resulting fingerprints.
- `.scaler/debug/reports.json` — debug-agent conclusions and escalation decisions.
- `.scaler/debug/retries.json` — explicit next-approach retry executions, exact validation reruns, and follow-up debug-attempt links.
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

`/scaler-debug-retry [taskId] [execute]` turns the latest accepted `next_approach` report for a debugging task into a supervised retry. Prepare mode builds the retry task-agent prompt with the next approach and exact failing validation command(s). Execute mode runs the task agent, reruns only the exact command(s) that failed previously, records `.scaler/debug/retries.json`, and records a structured debug attempt. If exact validation passes, the default policy leaves the task `validating` for full validation. If exact validation fails, the task returns to `debugging` with a `same_failure` attempt.

`/scaler-debug-retry-policy` stores retry automation policy in `.scaler/debug/retry-policy.json`:

```text
/scaler-debug-retry-policy
/scaler-debug-retry-policy auto-start=on require-approval=off post-exact-pass=validate
/scaler-debug-retry-policy auto-start=off require-approval=on post-exact-pass=stop
```

Defaults are `autoStart=false`, `requireApproval=false`, and `postExactPass=stop`. `post-exact-pass=validate` runs full validation after exact validation passes. `post-exact-pass=validate-commit` also attempts the validated-task commit after full validation passes, using the task's allowed paths.

When `requireApproval=true`, executed retries need a matching one-use approval record under `.scaler/debug/retry-approvals.json`:

```text
/scaler-debug-retry-approve RPT-DEBUG | T-001 | Approve one controlled retry
/scaler-debug-retry-approvals
```

`/scaler-debug-retries` lists recent next-approach retry records.

`/scaler-debug-loop [taskId] [execute] [max=N]` automates the current debug-agent/research-agent/replanner-agent handoffs for one debugging task. It is deterministic and bounded:

1. If a task-local debug-cycle/debug-blocked replan request is open, it runs the replanner agent and stops after a proposed plan is staged.
2. Else if a task-local research request is open, it runs the research agent and then re-evaluates the debug task.
3. Else it runs the debug agent.

The loop normally stops on prepare-mode handoff, rejected structured ingestion, `next_approach`, proposed replan generation, no debugging task, or max steps. If retry policy has `auto-start=on`, the loop starts `/scaler-debug-retry` after a `next_approach` report and stops after the retry is prepared, exact validation passes, exact validation fails, or the retry is rejected. It never accepts a proposed plan automatically; `/scaler-replan-accept` remains the preservation-gated current-plan replacement path.

## Current limitations

Use `/scaler-validate-loop` when you want validation to explicitly hand off into the bounded debug loop; plain `/scaler-validate` remains validation-only. Internet research still depends on explicitly granted tools and safety policy.
