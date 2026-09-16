# Planning and Evidence-Based Replanning
Requirements: SC-03, SC-12. Acceptance: AC-03, AC-12.

## Minimal planning

Before effects, define the goal, constraints, a task contract and acceptance.
Use a one-task plan when sufficient. Do not require separate PRD/research/planning
agents or documents when inputs are already adequate.

Represent dependencies explicitly. Reject missing references, cycles and work
whose inputs depend on unaccepted outputs. Validate the ready frontier against
current input versions, authority, context and resources before execution.
A dependency graph does not imply parallel execution.

## Progressive detail

Keep distant milestones coarse. Expand a bounded next-work frontier into concrete
contracts before execution. Experiments/POCs may resolve uncertainty before a
detailed implementation plan; they need bounded scope and explicit outcomes.

## Replanning

Replan when evidence changes goal feasibility, dependencies, scope, assumptions or
acceptance. Local repair stays within the current task when possible.
Record old/new plan versions, reason, evidence, preserved/changed/replaced tasks,
context and validation impacts, and next work.

Preserve accepted artifacts whose basis remains valid. Do not preserve a validated
label when its requirement/source changed. Retain historical acceptance, mark
current applicability obsolete/stale, and create corrective/revalidation work.
An explicitly superseded user requirement need not remain artificially covered.

Agents propose changes; the supervisor checks references, cycles, authority and
acceptance implications. Scope expansion outside the user's authorization needs
a decision; correcting the execution method within it does not.

## Continuation

Provide the planner only the relevant requirement/plan slice, dependency
boundaries, current failure, compact attempt history and evidence references.
After acceptance, update affected future contracts and resume from the next
eligible task without restarting still-valid work.
