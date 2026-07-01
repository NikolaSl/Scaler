# SCALER Tool/MCP Safety and Execution Spec

## Purpose

Tool and MCP execution must preserve requester-agent focus and reduce token usage.

The requester agent should not carry full tool/MCP documentation, long tool histories, or unrelated protocol details in its active context.

## Principle

The requester agent sees only a short catalog of available tools/MCPs.

When it needs a tool, it sends a structured tool request with:

- tool/MCP name
- free-form request
- expected result
- safety/risk notes when known

The exact tool/MCP usage is delegated to an isolated tool agent.

## Tool catalog

Each agent may receive a short tool catalog:

- name
- short purpose description
- risk level when known
- whether full docs/schema are available

Full documentation/schema should not be injected into normal requester-agent context unless needed.

## Structured tool request

A tool request should include:

- request id
- requester agent id
- task id, if any
- tool/MCP name
- free-form request
- expected output
- required format, if any
- risk level: `low`, `medium`, `high`, `destructive`, `unknown`
- permission requirement, if any

The free-form request may be arbitrary text because the short tool description is not enough to encode every tool-specific input format.

## Tool-agent execution

For each structured tool request, Scaler spawns or runs an isolated tool agent with minimal context:

- selected tool/MCP docs or schema when available
- free-form request
- safety rules
- output/report format

The tool agent should:

1. Inspect available schema/docs/help.
2. Understand the requester agent's free-form request.
3. Prepare the exact tool/MCP call.
4. Execute the call when safe and allowed.
5. Validate whether the result satisfies the original request.
6. Continue for a few focused iterations when correction, pagination, follow-up calls, or result completion is needed.
7. Stop when the request is satisfied or when it can explain why fulfillment is not possible.
8. Return a concise result report to the requester agent.

## Documentation discovery

If MCP documentation/schema is available, the tool agent should use it.

If a CLI/tool has no documentation, the tool agent may inspect usage with:

- `--help`
- `-h`
- `help`
- man pages
- local docs
- safe dry-run commands when supported

The tool agent must not invent unsupported arguments when usage is uncertain.

## Parallel/multiple requests

A single requester-agent iteration may produce multiple structured tool requests.

Scaler can execute them independently or in parallel when safe. Results are returned to the requester agent as separate concise reports.

Requests that have side effects, shared resources, or ordering dependencies must be serialized.

## Safety rules

For risky tools/actions:

- Follow `specs/safety-permissions.md`.
- Prefer dry-run or read-only mode when available.
- Require approval for destructive, external, deployment, publishing, or secret-touching actions according to safety policy.
- Do not execute unknown high-risk operations only because the tool agent inferred them.
- Keep exact command/request and result in logs.

## Failure handling

If execution fails or result is incomplete, the tool agent should:

1. Record exact failure.
2. Inspect docs/help if not already done.
3. Try corrected or follow-up calls when safe.
4. Avoid repeating failed calls.
5. Continue only while each iteration is directly moving toward satisfying the original request.
6. Report failure with evidence and explanation when it cannot satisfy the request.

## Tool result report

The result report should include:

- request id
- tool/MCP name
- status: `satisfied`, `partial`, `failed`, `blocked`, `needs_permission`
- concise answer for requester agent
- exact command/request used
- important outputs or references
- files/logs created
- validation performed
- failure details, if any
- safety notes, if any

## Logging

All tool/MCP requests and executions must be logged according to `specs/logging.md`.

Large raw outputs should be stored by reference and managed according to `specs/storage.md`.
