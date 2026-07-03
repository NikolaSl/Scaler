# Research Evidence

SCALER stores research requests and research reports under `.scaler/research/`.

Artifacts:

- `.scaler/research/requests.json` — research questions with status, scope, task links, and runtime PRD refs.
- `.scaler/research/reports.json` — structured findings with sources, source quality, confidence, contradictions, unresolved unknowns, recommendations, and memory refs.
- `.scaler/memory/<memory-id>.md` — raw research evidence and long excerpts preserved outside active context.

## Source quality and confidence

Source quality values rank evidence from strongest to weakest:

1. `project`
2. `official`
3. `primary`
4. `trusted`
5. `reputable`
6. `weak`
7. `unknown`

Conclusion confidence values are `high`, `medium`, `low`, or `unknown`.

Contradictions are recorded as `resolved` or `unresolved`. Resolved contradictions require a resolution note.

## Commands

```text
/scaler-research-status
/scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>
/scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>
```

`scope` is `local`, `internet`, or `mixed`.

The compact report command records one source and one conclusion. Use the `scaler_research_report` tool for full reports with multiple sources, contradictions, unresolved unknowns, recommendations, and raw evidence.

## Tool

`scaler_research_report` records structured research and can preserve raw evidence into `.scaler/memory/` automatically.

## Current limitations

SCALER now has deterministic research/evidence ledgers, but it does not yet perform internet search, browser/MCP research, or multi-agent research orchestration automatically.
