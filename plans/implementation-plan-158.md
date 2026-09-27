# PLAN-158 — Autonomous missing-context FSM continuation

## Requirement and observed gap

When an execution worker reports `needs_data`, the supervisor already records a
typed missing-context request and blocks the task. The explicit
`/scaler-missing-context-run` command can dispatch that request, but
`runScalerAutomation` stops at the blocked task without invoking the same
validated FSM. This leaves an otherwise local-only autonomous run requiring an
operator command between two existing supervisor transitions.

## Minimal implementation

Extend the automation loop to handle one unresolved missing-context request for
the blocked task at a time:

1. dispatch the existing typed request through `dispatchMissingContextRequest`;
2. for a dispatched local research request, run the existing research agent;
3. refresh accepted research evidence and unblock only when every request for
   the task is resolved;
4. continue normal task execution from a fresh state.

Memory and exact-file requests keep their existing programmatic resolvers.
Internet, user and tool requests keep their existing explicit permission or
operator boundaries. A failed, malformed, partial or unresolved research result
stops truthfully; it is not treated as context and is not retried inside the
same automation run.

No new retrieval subsystem, planner, routing policy or context format is added.
The worker still proposes what is missing; the supervisor validates request
type, authority, research evidence and the blocked-to-ready transition.

## Acceptance and limits

A deterministic integration regression must demonstrate:

- a task worker reports an unknown local fact and transitions to `blocked`;
- automation dispatches exactly one local research request and receives one
  complete attributed report;
- the supervisor resolves the request, returns the task to `ready`, and gives
  the retry the bounded research claim through its context manifest;
- the retry, validation and completion proceed through the existing FSM;
- no internet grant or model-quality claim is involved.

Run the focused regression, then the applicable build, unit/mock-integration,
conformance and `git diff --check` gate once on the candidate tree.
