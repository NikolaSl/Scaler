# Task Agents

Scaler has an experimental task-agent subprocess runner.

The runner builds isolated Pi invocations using JSON print mode:

```text
pi --mode json -p --no-session <task-prompt>
```

Supported options:

- limited tools via `--tools`
- model selection via `--model`
- generated system prompt file via `--append-system-prompt`
- extension loading via `-e`
- working directory per task

Child agents must load Scaler safety/logging rules or run inside an approved sandbox before unattended use.

Current implementation provides the invocation builder and basic subprocess runner. Full supervisor integration will be added later.
