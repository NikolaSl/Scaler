# Research Evidence

SCALER stores research requests and research reports under `.scaler/research/`.

Artifacts:

- `.scaler/research/requests.json` — research questions with status, scope, task links, and runtime PRD refs.
- `.scaler/research/reports.json` — structured findings with sources, source quality, confidence, contradictions, unresolved unknowns, recommendations, and memory refs.
- `.scaler/reports/research-agent-runs.json` — focused research-agent preparation/execution records.
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
/scaler-research-run [requestId] [execute]
/scaler-research-runs [requestId]
/scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>
/scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>
```

`scope` is `local`, `internet`, or `mixed`.

`/scaler-research-run` prepares the focused research-agent prompt for a selected request or the oldest open request. Passing `execute` runs the subprocess under the repo-wide execution lock and ingests only a valid structured `scaler_research_report` JSON event. Runs are recorded under `.scaler/reports/research-agent-runs.json`.

`/scaler-research-runs` lists recent research-agent run records, optionally filtered by request id.

The compact report command records one source and one conclusion. Use the `scaler_research_report` tool for full reports with multiple sources, contradictions, unresolved unknowns, recommendations, and raw evidence.

Accepted child JSON event shape:

```json
{
  "type": "scaler_research_report",
  "requestId": "RESEARCH-001",
  "question": "Which API should be used?",
  "status": "complete",
  "sources": [{ "id": "docs", "title": "Official docs", "quality": "official", "url": "https://example.invalid/docs" }],
  "conclusions": [{ "summary": "Use the documented API.", "confidence": "high", "sourceRefs": ["docs"] }],
  "contradictions": [],
  "unresolvedUnknowns": [],
  "recommendations": ["Add validation around the API call."],
  "rawEvidence": [{ "title": "Docs excerpt", "content": "Long excerpt", "sourceId": "docs" }]
}
```

## Tool

`scaler_research_report` records structured research and can preserve raw evidence into `.scaler/memory/` automatically.

## Current limitations

SCALER now has deterministic research/evidence ledgers and focused research-agent subprocess prompts with structured report ingestion. It does not yet perform internet search, browser/MCP research, or multi-agent research orchestration automatically beyond tools explicitly granted to the subprocess.
