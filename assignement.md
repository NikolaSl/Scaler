# SCALER Assignment

## I. Problem

Main problems with classic agentic flow:

- Distraction — too much context data, often covering different subjects, where only part is useful for the immediate subtask. This can make the LLM lose focus or hallucinate.
- Amnesia and Chinese whispers — limited context requires compression. During compression, details are lost. The farther back information is in history, the more often it is compressed, until it is forgotten or changed into something no longer true.
- Cost of operation — in a single-agent loop, context keeps growing and is always reinjected as input tokens, even when it is not needed for the immediate task.
- Cost of MCP and tools — if MCP is active, its documentation is always added to context. Even when unused, it costs input tokens and contributes to amnesia, distraction, and cost. Because it comes with full session history, hallucinations or distractions can also affect how the tool or MCP is used.
- LLM agents often try to handle multiple problems at once, so when something fails, catching and resolving the problem is complicated.
- When an LLM agent gets stuck, it often repeats a few suggested but non-working solutions, or the solution chain leads back to the original problem.

## II. Goal

Build a Pi-Agent-based agentic architecture that reduces the problems above and allows Pi-Agent to handle larger problems with fewer context, focus, and cost issues.

Each call should be focused, use only the information needed for the immediate task, and minimize input tokens. Tasks should be atomic, iterative, and validated. Problems should be detected and debugged as early as possible.

## III. Solutions

### 1. Deterministic execution supervisor

Scaler must have a deterministic supervisor/state machine around all LLM agents.

The supervisor is not an LLM. It reads structured reports, validates required fields, updates persistent state, and decides the next allowed transition.

Agents can reason, investigate, implement, debug, and report. The supervisor controls process discipline.

See `specs/supervisor.md` for states, transitions, report rules, and persistent state.

### 2. Adaptive orchestration

Scaler must use the lightest reliable process for the current request.

Simple tasks should not trigger full Stage I-IV orchestration, many agents, deep research, or heavy CI/CD. Complex, risky, or unclear tasks can escalate on demand into the full supervised workflow.

See `specs/adaptive-orchestration.md`.

### 3. Multi-stage context selection

Context selection decides what enters an agent's active context.

The planner creates the first context manifest for each task, but the final task context is resolved just before spawning the task agent using latest validated state, memory references, file state, and validation needs.

Task agents can request missing data, memory, local investigation, or internet investigation when allowed. They must not guess when required context is missing.

See `specs/context-selection.md`.

### 4. Research and information quality

Scaler must support local and internet research with evidence quality rules, source ranking, contradiction handling, and completeness criteria.

Research should collect enough reliable information for planning or execution without dumping raw search results into active context. Conclusions, confidence, and evidence references should be kept in context; raw sources and notes should be stored in memory/logs.

Research can use Pi skills, custom extension tools, MCP search/browser/documentation servers, browser automation, safe CLI/network tools, and local project sources when available.

See `specs/research.md`.

### 5. Optimize MCP and tool execution

Agents receive only a short catalog of available tools/MCPs, not full documentation in active context.

When an agent needs a tool, it creates a structured tool request with the tool/MCP name and a concise free-form request. A separate isolated tool agent receives only the selected tool/MCP information, safety rules, and the request.

The tool agent prepares and executes the exact tool/MCP transaction, discovers usage with docs/help when needed, and may continue for a few focused iterations until the request is satisfied or it can explain why fulfillment is not possible.

A single requester-agent iteration may create multiple tool requests. Scaler can execute them independently or in parallel when safe, then return separate concise reports.

See `specs/tool-mcp-safety.md`.

### 6. Enhance context compression

When compression is needed, ask the LLM to follow these instructions:

1. Based on all context data and the agent's main goals, remove all data that is no longer needed. For example:
   - Output from already resolved subtasks where intermediate steps are not needed.
   - Output from wrong, failed, or abandoned directions.
   - Anything that will not be needed to reach the main goals.
2. Preserve unchanged any information where exactness is important. For example:
   - API or function call descriptions where one changed symbol can cause syntax or format errors.
   - Standards, laws, or contracts that must be followed, executed, or interpreted with exact precision.
3. For the remaining data, replace it with the most compact possible summary without losing details important for the main goals.
4. If context size is still over 75% of the context window after compression:
   - Stop adding more data to the same session.
   - Split the remaining work into smaller atomic tasks.
   - Move large but needed data into external files or task reports.
   - Keep only references, summaries, current goal, next action, and validation state in the active context.
   - Spawn new task agents with fresh minimal context when needed.

### 7. External file memory

External memory is cheap. Tokens are expensive.

When details may be useful later but are not needed for the current task, the agent moves them to files in `.scaler/memory/` and keeps only short references in active context.

If the agent needs memory later, it creates a structured memory-retrieval request. The agent loop retrieves only the requested useful content before the next iteration.

See `specs/memory.md`.

### 8. Spawn task agents for atomic tasks

For each atomic task, spawn a dedicated task agent with only the information needed to resolve that exact task.

Atomic means the smallest useful consistent task that can be completed, compiled/checked, and tested independently, without depending on not-yet-completed tasks. It should be small enough to minimize errors and simplify debugging, but not so small that trivial related changes create wasteful execution cycles.

Do not depend on fixed predefined roles. The conductor/planner can generate a custom role, prompt, tool set, and context for each task. Predefined prompts may be used only as templates.

Each task agent follows the same contract: narrow scope, minimal context, allowed tools only, missing-data requests instead of guessing, validation, and structured report to the caller.

See `specs/task-agents.md`.

### 9. Logging and audit trail

Scaler must keep active context small while preserving a full audit trail in `.scaler/logs/`.

Agents may summarize or remove middle investigation/debug steps from active context after a decision, but raw steps, tool calls, validation results, state transitions, prompts, and reports must remain available in structured logs.

These logs should allow later investigation of what happened, why decisions were made, and how Scaler can be improved from real runs.

See `specs/logging.md`.

### 10. Storage management

External memory and logs can grow large. Scaler must manage `.scaler/` storage with configurable limits, compression, rotation, indexing, and pause rules before disk becomes unsafe.

Large logs and tool outputs should be stored, compressed, and retrieved by reference instead of injected into active context.

See `specs/storage.md`.

### 11. Budgets and watchdogs

Scaler must have explicit budgets and watchdogs for tokens, cost, tool calls, spawned agents, wall-clock time, storage, debug attempts, research, and validation loops.

Soft limits should warn and reduce scope where possible. Hard limits should pause safely, checkpoint state, and report options instead of running uncontrolled.

See `specs/budgets-watchdogs.md`.

### 12. Attempt tracking and debugging

Debugging must be structured, evidence-based, and loop-resistant because it is where agents often spend the most tokens.

Each failure should create a failure record. Each attempted fix or investigation step should create an attempt record with hypothesis, action, validation result, and log references.

Scaler should detect repeated attempts and cyclic fixes. When this happens, the same cycle must not continue; the task agent must investigate the exact problem and propose a different evidence-backed approach.

Only when the task agent cannot complete the investigation or propose a working solution, the conductor pauses execution and sends the new information to Stage II/III for plan update.

See `specs/attempt-tracking.md`.

### 13. Validation gates

A task is complete only when required validation gates pass and the supervisor accepts the validation report.

Software tasks should use the strongest practical gates: dependency check, test-first check, build/compile, unit tests, integration tests, static checks, and acceptance/smoke tests when available.

When needed by PRD or planning, Scaler should build local CI/CD validation environments using Docker, dev containers, Docker Compose, or Minikube. These controlled sandboxes are also a safety mechanism that allows more unattended execution without weakening host-level security rules.

Non-software intellectual tasks should be validated for completeness, consistency, compliance, source support, adversarial questions, and unresolved uncertainty.

See:

- `specs/validation.md`
- `specs/cicd-environment.md`

### 14. Replanning protocol

The initial plan is only the best plan available before empirical execution. The plan is expected to change when real work reveals missing facts, wrong assumptions, impossible tasks, or need for a proof of concept.

Replanning must preserve validated progress and update only what execution evidence shows should change.

Scaler must maintain a runtime PRD ledger for active runs so replanning uses deterministic requirement records, task links, coverage state, PRD change history, and PRD version snapshots instead of relying on compressed conversation memory. The ledger should preserve the current polished PRD, stable requirement ids, coverage status, linked tasks, validation evidence references, and prior PRD versions.

See:

- `specs/replanning.md`
- `specs/runtime-prd-ledger.md`

### 15. Safety, permissions, and secure development

Scaler must use deterministic safety gates for risky actions, protected paths, secrets, internet access, deployment, publishing, and destructive operations.

Scaler should prefer controlled sandbox execution for unattended risky work. Security exceptions may be allowed inside approved sandboxes only when they cannot harm the host, secrets, production systems, or external users.

Software changes should follow security-by-design. Docker images, third-party modules, libraries, and dependencies should be scanned for CVE/security issues where tools are available.

See `specs/safety-permissions.md`.

### 16. Git progress tracking

Every project should be a git repository unless disabled or impossible.

Each validated task that changes project files should be committed with the task id and a short meaningful message, so repository history shows project progress task by task.

Scaler must avoid committing unrelated user changes, secrets, or large Scaler runtime logs/artifacts.

See `specs/git-workflow.md`.

### 17. Pi extension architecture

Scaler should be implemented as a Pi extension using custom commands, structured tools, event hooks, isolated Pi subprocess agents, `.scaler/` state, and deterministic supervisor logic.

See `specs/pi-extension-architecture.md`.

### 18. Address the problem in stages

For complex enough requests, instead of directly executing the user request and PRD, the main loop, called the conductor loop, solves it in stages and steps.

#### Stage I: Collect and polish the PRD

This runs in a separate PRD agent. The agent receives user input and can work with files and folders containing arbitrary PRD-like data. The agent goals are:

1. Review the user request/input and PRD, then organize them into a well-structured, easy-to-understand agent PRD.
2. Review the resulting PRD for consistency.
3. If there are contradictions, incomplete requirements, or unclear requirements/definitions, start a chat with the user to clarify them. Continue until all problems are resolved and compliant with the rest of the PRD.
4. Finish with an updated and consistent polished PRD written to `agent-prd.md` in the main folder.
5. Update the runtime PRD ledger with the polished PRD, stable requirement ids, and a change record.

#### Stage II: Collect knowledge for PRD execution

This runs in a separate knowledge-collector agent. It uses the PRD from Stage I to identify what must be known before planning.

The agent should investigate active project folders and, when needed, internet sources. It must distinguish signal from noise using source quality and completeness criteria from `specs/research.md`.

Its goals are:

1. Extract all technical, business, and implementation questions from the PRD.
2. Check what is already known from the project files and existing documentation.
3. Collect missing information from reliable sources.
4. Resolve or document contradictions and uncertainty.
5. Store important findings in files when they are too large or exactness is important.
6. Structure findings so they are easy to reference from the execution plan.
7. Finish with a knowledge report that can be used together with `agent-prd.md` as input for planning.

#### Stage III: Prepare an execution plan

This runs in an architect/planner agent. It uses Stage I and Stage II outputs to create a detailed sequential plan.

Each task in the plan should be:

- Atomic and ordered for one-by-one execution.
- Linked to the PRD requirement or knowledge data needed for completion, using runtime PRD requirement ids where available.
- Clear about inputs, expected output, and constraints.
- Defined with a Definition of Done so the execution engine can validate completion.

If the PRD includes software, the plan should include CI/CD and validation environment setup where possible: compile/build, dependency validation, unit tests, integration tests, Docker/dev-container/Compose setup, and, if useful, Minikube or sandbox deployment with acceptance tests.

#### Stage IV: Execute the tasks/steps of the execution plan

This runs as sequential execution of task agents. Each task agent receives one atomic task, required references, and its Definition of Done.

For software tasks:

1. Write or update unit tests first.
2. If modifying existing code, update the related tests before implementation.
3. Implement the change.
4. Update integration tests when needed.
5. Validate that dependencies are resolved.
6. Validate that the code builds/compiles, or is correct if it is not compiled code.
7. Run unit tests and integration tests.
8. If available and required, run acceptance tests in Docker, dev container, Compose, Minikube, or sandbox.

For non-software intellectual tasks:

1. Produce the required output.
2. Validate logical completeness, consistency, and compliance with the PRD.
3. Ask critical questions that try to invalidate the result.
4. Validate or invalidate important statements using reliable local or internet sources when possible.

Each task must be fully checked before moving to the next one. If validation fails, debugging starts immediately inside the same task loop.

Execution can reveal new facts that require plan changes, new investigation, or proof-of-concept tasks. In that case, the conductor should pause execution, update the needed Stage II/III outputs, create a new plan version, and continue with the corrected plan while preserving validated progress.


