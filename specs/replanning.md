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

## Coverage and necessity

At initial planning, each decomposition and each replan, check both directions:

- Every active requirement has a sufficient planned path to acceptance.
- Every task serves an authorized requirement directly or through a justified
  necessary prerequisite. Links alone do not establish necessity.

For a disputed task, identify the requirement or correctness criterion that would
fail without it. Check whether that dependency comes only from an unnecessarily
complex chosen approach and whether a simpler sufficient approach removes it.
Reject unjustified work before execution; missing coverage requires correction.

Distinguish explicit outcomes, necessary implementation steps, and optional
enhancements. Thematic relevance, common practice, future extensibility and a
reviewer's preference MUST NOT create scope or mandatory acceptance criteria.
Optional suggestions stay outside executable work unless authorized. Do not
interrupt delivery to seek approval for every unsolicited improvement.

Derive necessary checks from the requested behavior and applicable constraints;
the user need not enumerate technical steps. Resolve consequential ambiguity by
bounded investigation or clarification, never by silently inventing a requirement.
Checks may be compact and reused while their requirement/plan basis is unchanged.

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
Evidence invalidating an assumption may change the method, but does not itself
authorize a new product goal. Independent review uses the same scope boundary.

## Continuation

Provide the planner only the relevant requirement/plan slice, dependency
boundaries, current failure, compact attempt history and evidence references.
After acceptance, update affected future contracts and resume from the next
eligible task without restarting still-valid work.
