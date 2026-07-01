# SCALER Context Selection Spec

## Purpose

Context selection decides what enters an agent's active context.

The goal is to give each task agent enough information to complete the current task, while avoiding distraction, hallucination, context bloat, and unnecessary token use.

## Principle

Context selection is multi-stage and adaptive.

The planner makes the first context plan, but the final context is resolved just before task execution using the latest validated state.

## Stage 1: PRD context extraction

During PRD polishing, extract stable references:

- requirement ids
- constraints
- definitions
- acceptance criteria
- open questions
- exact text that must be preserved

Large PRD details should be stored as referenced files or memories, not repeatedly copied into every task context.

## Stage 2: Knowledge context inventory

During knowledge collection, create reusable references:

- project files and relevant sections
- external source summaries created according to `specs/research.md`
- API/tool/protocol notes
- decisions and assumptions
- memory files for large findings

Each knowledge item should include source, reliability, related requirements, and when it is useful.

## Stage 3: Planning context manifest

During planning, each task receives a context manifest.

The manifest should define:

- required PRD references
- required knowledge references
- required previous task outputs
- required files or sections
- required memories
- validation references
- optional references
- known missing data

The plan should reference data by id/path instead of embedding large content.

## Stage 4: Post-task context update

After each validated task, the supervisor updates execution state and dependent task manifests when needed.

If these updates change task order, dependencies, assumptions, or scope beyond local manifest updates, follow `specs/replanning.md` and create a new plan version.

Update future tasks with:

- completed outputs
- changed files
- created memories
- new findings
- invalidated assumptions
- validation results
- known blockers

This keeps future task context aligned with empirical execution reality.

## Stage 5: Pre-spawn context resolver

Before spawning a task agent, Scaler resolves the actual initial context from:

- task definition and Definition of Done
- latest supervisor state
- context manifest
- validated previous task reports
- relevant memory index entries
- current file state
- validation commands/checks

The resolver should inject only the smallest useful context for the current task.

## Stage 6: In-task retrieval

If the task agent lacks data, it should not guess.

It can request:

- memory retrieval
- file or section retrieval
- tool/MCP information
- local investigation
- internet investigation when allowed, following `specs/research.md`
- user/conductor clarification

After retrieval or investigation, active context should keep only conclusions, evidence references, and next action. Raw steps remain in logs.

## Context item format

Each context item should have:

- id
- type: `prd`, `knowledge`, `memory`, `file`, `task_report`, `validation`, `tool`, `decision`
- source path/id
- reason for inclusion
- related task/requirement
- scope: full, section, snippet, summary, reference-only
- priority: required, useful, optional
- exactness: exact, summary-ok, reference-only
- estimated size when available
- freshness/validity status

## Relevance rules

Include a context item only when:

- it is needed for the current task goal, DoD, validation, or safety
- it explains a dependency from a validated previous task
- it prevents likely hallucination or wrong implementation
- it is required exact data

Do not include data only because it is generally related.

## Size rules

- Prefer references and summaries over full content.
- Include exact text only when exactness matters.
- Include file sections/snippets before full files.
- Keep broad PRD, knowledge, and history out of task context unless needed.
- Use configurable context budgets per stage and task.

## RAG policy

RAG/search may be used to find candidate memories or documents, but it should not automatically inject broad results into context.

Recommended flow:

1. Search index.
2. Return small candidate list with reasons.
3. Select only justified items.
4. Retrieve specific sections when possible.

This avoids reintroducing context pollution through automatic retrieval.

## Missing-context report

When context is insufficient, the task agent should report:

- missing data
- why it is needed
- likely source
- whether task can continue without it
- requested retrieval/investigation action

The supervisor then blocks, retrieves, investigates, or replans according to state rules.
