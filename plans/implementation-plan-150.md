# PLAN-150 — P3 execution-role prompt contract

## Status

Implemented on `implementation/v2-p3-proportional-routing`; phase review and
merge pending. Not part of PR #24.

## Observed gap

The conductor prompt exposes the task status and supervisor stage but does not
explicitly state the execution worker's role or the distinction between a model
proposal and a supervisor transition. This makes the model's permitted choices
for sub-context, missing data and task splitting less clear even though the
runtime remains authoritative.

## Bounded unit

1. In the conductor's task-agent prompt, give an execution-specific role and
   explain the current state, admitted task, allowed proposals and structured
   output contract before the source context.
2. Tell the worker it may propose a narrower context, missing-source retrieval
   or a task split/replan, but may not add tasks, broaden paths, approve its own
   context, change criteria or advance the FSM. The supervisor validates each
   proposal under the current task contract and state.
3. Distinguish `completed` as ready for independent validation, `needs_data`
   for missing required context, and `needs_replan` for a proposed split. State
   that no report status alone changes accepted scheduler state.
4. Keep existing prompt admission, report schema, and execution semantics intact.

## Validation evidence

Test the rendered preview and dispatched prompt for role/allowed-proposal text,
including missing-data and split guidance. Ensure the actual prompt builder is
used, not a duplicate fixture. Run focused conductor tests, the TypeScript
build and `git diff --check`; run the full applicable gate before publishing
the completed unit or opening a PR.

The test-first assertions failed on the original preview and dispatched prompt.
The implementation adds only the execution-state role block and compacts existing
duplicate instructions so a constrained 1,000-token projection remains admitted.
After preserving explicit no-guessing language, 47/47 focused conductor tests pass.
The final implementation-and-documentation tree passes the TypeScript build,
1,155/1,155 unit/component tests, 68/68 mock integration tests,
7/7 conformance/autopilot tests and `git diff --check`. The final evidence-only
commit changes this plan, so the executable tree is identical to that gate.

## Limits

This is clarity in one existing execution-state prompt. It does not implement
automatic subtask planning, automatic context approval, a current-agent tool
route, local-model dispatch, or semantic correctness checks. Those remain
separate bounded requirements and acceptance evidence.
