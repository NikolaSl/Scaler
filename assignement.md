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

### 1. Optimize MCP and tool execution

Each agent or subagent has a permanent list of available tools and MCPs. The list includes the tool/MCP name and a short description of its purpose.

When an agent wants to use a tool, it makes a structured tool request that includes the tool/MCP name and a concise free-form description of what it needs.

The agent loop detects structured tool requests and, for each one:

- Prepares a new session context that includes only the selected tool/MCP information and the free-form request.
- Executes a new tool agent with this context to collect data for the next requester-agent iteration.
- If MCP documentation is available, the tool agent uses it to prepare and execute the MCP transaction.
- If a tool has no documentation, the tool agent can inspect it with `--help` or a similar discovery approach.
- The tool agent returns a meaningful answer to the requester agent.
- If the transaction fails or returns an incomplete result, the tool engine keeps correcting or extending the transaction until it gets the desired result or reports failure.

This allows a single requester-agent iteration to make multiple requests to multiple tools. Each request is executed with the smallest useful tool context and the exact request, improving focus and reducing token usage where possible.

### 2. Enhance context compression

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

### 3. External file memory

When details may be useful later but are not needed for the current task, the agent can move them to files in a `memory/` folder.

The active context should keep only:

- A short description of the memory.
- A link/path to the memory file.
- When and why it may be useful.

This keeps the session context small and focused while preserving retrievable details.

If the agent needs one or more memories later, it creates a structured memory-retrieval request. The agent loop detects the request, reads the referenced memory files, and injects the retrieved content before the next iteration.

### 4. Spawn agents for atomic tasks

For each atomic task, spawn a dedicated task agent with only the information needed to resolve that exact task.

The task-agent prompt should be engineered for the optimal result. It should clearly define the agent role, task goal, expected output, constraints, validation rules, and reporting format.

The initial session context should include only data required to perform the atomic task. This keeps the agent focused and minimizes token usage.

When the task agent finishes, it generates a report for the caller agent. The caller agent can:

- Accept the task result.
- Add more data or action items and continue the task-agent loop.
- Receive a request for missing data when the task agent cannot complete the task with the provided context.

This also creates a controlled mechanism for task agents to request additional information from the caller instead of guessing or hallucinating.

### 5. Debugging issues

Debugging must be structured so even weaker LLMs can follow it reliably and avoid repeating failed approaches.

When a failure appears, the task agent should:

1. Record the exact failure: command, error, logs, expected result, and actual result.
2. Identify the smallest reproducible case.
3. Create a fix execution stack with short descriptions of attempted solutions and results.
4. List possible causes and rank them by likelihood.
5. Try the most probable solution first.
6. Test one cause at a time with the smallest possible change.
7. After each change, rerun the exact failing validation.
8. If fixed, rerun the full task validation.
9. If not fixed, record the attempt and try a new approach instead of repeating it.

The agent should detect loops where one fix causes a new problem, and another fix brings back the previous problem. When a loop is detected, the same cycle must not continue. The agent must investigate the exact task problem and propose a different approach.

Investigation order:

1. Check local project files, documentation, logs, tests, and history.
2. If there is not enough local data, use reliable internet sources.
3. Store long investigation notes in files when needed.

The debug report should include:

- Failure summary.
- Reproduction steps.
- Attempted fixes and results.
- Root cause, if found.
- Final changes made.
- Validation results.
- Remaining risks or blockers.

Only when the task agent cannot complete the investigation or propose a working solution, the conductor pauses execution and sends the new information to Stage II/III for plan update.

When updating the plan, the planner must receive the current execution state, including completed and validated tasks, current failed task, attempted fixes, and remaining tasks.

### 6. Address the problem in stages

Instead of directly executing the user request and PRD, the main loop, called the conductor loop, solves it in stages and steps.

#### Stage I: Collect and polish the PRD

This runs in a separate PRD agent. The agent receives user input and can work with files and folders containing arbitrary PRD-like data. The agent goals are:

1. Review the user request/input and PRD, then organize them into a well-structured, easy-to-understand agent PRD.
2. Review the resulting PRD for consistency.
3. If there are contradictions, incomplete requirements, or unclear requirements/definitions, start a chat with the user to clarify them. Continue until all problems are resolved and compliant with the rest of the PRD.
4. Finish with an updated and consistent polished PRD written to `agent-prd.md` in the main folder.

#### Stage II: Collect knowledge for PRD execution

This runs in a separate knowledge-collector agent. It uses the PRD from Stage I to identify what must be known before planning.

The agent should investigate active project folders and, when needed, internet sources. Its goals are:

1. Extract all technical, business, and implementation questions from the PRD.
2. Check what is already known from the project files and existing documentation.
3. Collect missing information from reliable sources.
4. Store important findings in files when they are too large or exactness is important.
5. Structure findings so they are easy to reference from the execution plan.
6. Finish with a knowledge report that can be used together with `agent-prd.md` as input for planning.

#### Stage III: Prepare an execution plan

This runs in an architect/planner agent. It uses Stage I and Stage II outputs to create a detailed sequential plan.

Each task in the plan should be:

- Atomic and ordered for one-by-one execution.
- Linked to the PRD requirement or knowledge data needed for completion.
- Clear about inputs, expected output, and constraints.
- Defined with a Definition of Done so the execution engine can validate completion.

If the PRD includes software, the plan should include CI/validation environment setup where possible: compile/build, dependency validation, unit tests, integration tests, and, if possible, dev-container/sandbox deployment with acceptance tests.

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
8. If available, run acceptance tests in dev container/sandbox.

For non-software intellectual tasks:

1. Produce the required output.
2. Validate logical completeness, consistency, and compliance with the PRD.
3. Ask critical questions that try to invalidate the result.
4. Validate or invalidate important statements using reliable local or internet sources when possible.

Each task must be fully checked before moving to the next one. If validation fails, debugging starts immediately inside the same task loop.

Execution can reveal new facts that require plan changes or new investigation. In that case, the conductor should pause execution, update the needed Stage II/III outputs, and continue with the corrected plan.


