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
/scaler-research-run [requestId] [execute] [internet] [tools=a,b]
/scaler-research-runs [requestId]
/scaler-research-request <question> | <reason> | <taskId> | <PRD refs> | <scope>
/scaler-research-report <question> | <conclusion> | <confidence> | <sourceId> | <sourceTitle> | <sourceQuality> | <sourceRef> | <requestId> | <taskId> | <PRD refs>
```

`scope` is `local`, `internet`, or `mixed`.

`/scaler-research-run` prepares the focused research-agent prompt for a selected request or the oldest open request. Requests may be created manually or by accepted debug reports with status `needs_research`. Passing `execute` runs the subprocess under the repo-wide execution lock and ingests only a valid structured `scaler_research_report` JSON event. Runs are recorded under `.scaler/reports/research-agent-runs.json`.

For `internet` or `mixed` research scopes, SCALER distinguishes the request scope from actual tool grants. Internet-capable tools are not passed to the child process unless the command includes the explicit `internet` flag and a `tools=a,b` grant. Without such a grant, the prompt instructs the research agent to use local/project evidence only and report the missing internet capability as `partial` or `blocked` with unresolved unknowns. Example:

```text
/scaler-research-run RESEARCH-001 execute internet tools=browser,mcp-docs
```

Only the listed tools are passed to the subprocess. SCALER does not grant `bash` network transfer by default and existing safety hooks still block unsafe internet/deploy/publish/secret behavior.

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

SCALER now has deterministic research/evidence ledgers, focused research-agent subprocess prompts with structured report ingestion, and explicit internet-tool grant policy for internet/mixed requests. It does not yet discover browser/MCP tools automatically, perform multi-step web research by itself, or orchestrate multi-agent research beyond tools explicitly granted to the subprocess.
