# PLAN-166 — P3 acceptance-boundary reassessment

## Why this unit exists

PLAN-165 completed the remaining model-independent SC-08 routing admission
boundary. Before adding another P3 mechanism, reassess the remaining Partial and
Not assessed rows against the ordered roadmap and the user's clarified process
goal: a model proposes scoped work and context, while the supervisor validates
FSM transitions, authority and evidence. Model quality and token savings are not
process acceptance criteria.

This is a documentation and scope-control unit. It must not introduce code merely
to improve a status label.

## Findings

1. **SC-04:** P3 now supplies deterministic proportional initial routing and the
   direct/current-agent/isolated per-request FSM. The remaining risk-triggered
   direction assessment depends on P4 intent/necessity contracts and is explicitly
   owned by P5 in PLAN-099. It is not a missing P3 adapter.
2. **SC-05, SC-07 and SC-08:** their documented model-independent P3 boundaries
   are Verified. They cover exact request admission, on-demand necessary context
   and route execution/admission without claiming model quality.
3. **SC-09:** profile eligibility is deliberately non-authorizing. A configured
   local-only host/model run, resource envelope and retained end-to-end evidence
   are P7 acceptance work. No such environment is available here, so the row must
   remain Not assessed rather than be simulated.
4. **SC-25:** the supported Pi adapter's implemented discovery, focus, request
   admission and strict-child boundaries are evidenced. The remaining guaranteed
   final post-extension continuation payload is an actual-host capability limit;
   it cannot be truthfully closed by another local wrapper.
5. The unknown-path and on-demand information boundary requested for P3 was
   completed by PLAN-157 through PLAN-161, including declared 32,768- and
   131,072-token windows. No further context-access code gap is reproduced.

## Decision

Treat the planned model-independent P3 implementation units as complete. Preserve
the aggregate SC-04, SC-09 and SC-25 statuses and their explicit limitations;
phase completion does not mean every cross-phase requirement is globally
Verified.

The next implementation phase is P4: minimal/progressive planning, original
intent and constraints, assumption tracking, two-way coverage/necessity and
affected-only replanning. Its first unit must be selected only after a fresh gap
assessment. Do not pull P5 direction-review policy or P7 configured-local-profile
evidence forward into P4.

## Validation and publication

- Reconcile PLAN-099 and the current coverage notes with this ownership boundary.
- Confirm no open P3 PR, unresolved review thread or active continuation exists.
- Run `git diff --check` and documentation-reference checks relevant to changed
  files. No build or broad test rerun is justified by a documentation-only scope
  decision.
- Publish this as a logical plan commit followed by a separate traceability commit.
  Open a small P3 closure PR only after the exact remote tree matches the reviewed
  local tree.
