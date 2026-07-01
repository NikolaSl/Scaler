# Context Resolver

Scaler has a lightweight context resolver skeleton.

It builds task context from explicit context items:

- id
- type
- reason
- priority
- scope
- content
- estimated token size

Current behavior:

- required items are always included
- useful/optional items are omitted when over budget
- included items are ordered by priority
- output is a compact text block for task-agent prompts

Future work will connect this resolver to memory retrieval, plan manifests, and Pi `context` event filtering.
