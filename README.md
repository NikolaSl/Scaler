# SCALER

SCALER is a Pi extension for supervised autonomous project orchestration. It adds project-level state, staged planning, task agents, validation gates, debugging/retry flows, research, replanning, budgets, watchdogs, safety policies, tool-request workflows, and audit ledgers on top of the Pi coding agent.

## Quick start

Install dependencies:

```bash
npm install
```

Run type checks:

```bash
npm run build
```

Use SCALER from this checkout as a Pi package/extension. The package manifest exposes a named wrapper at `extensions/scaler/index.ts` so Pi lists the loaded extension as `scaler` instead of the implementation directory `src`.

```bash
pi install .
pi
```

Inside Pi:

```text
/scaler-status
/scaler <your project request>
/scaler-stage-workflow execute max=20 research=3 requests=5
```

## Documentation

- [`tutorial/index.md`](tutorial/index.md) — scenario-first tutorial for autonomous high-scale project work.
- [`tutorial/diagrams.md`](tutorial/diagrams.md) — GitHub-renderable Mermaid diagrams for orchestration, FSMs, context flow, MCP/tool flow, watchdogs, and storage.
- [`manual/index.md`](manual/index.md) — implemented behavior manual.
- [`manual/commands.md`](manual/commands.md) — full SCALER command reference.
- [`specs/index.md`](specs/index.md) — design/specification index.
- [`dev-progress-tracker/README.md`](dev-progress-tracker/README.md) — traceability matrix, implementation inventory, and gap backlog.

## Runtime files

SCALER stores project orchestration data under `.scaler/`. Local runtime files such as `.scaler/state.json`, `.scaler/logs/`, and `.scaler/watchdogs/` are ignored by default.

## License

Copyright 2026 Nikola Slavchev LZ1NKL.

Licensed under the Apache License, Version 2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
