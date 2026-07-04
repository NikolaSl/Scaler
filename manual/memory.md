# Memory

Scaler stores external memory under:

```text
.scaler/memory/
```

Current files:

- `.scaler/memory/index.json` — memory metadata index.
- `.scaler/memory/<memory-id>.md` — stored memory content.

Implemented tools:

- `scaler_memory_write` writes a memory file and index entry with optional tags and summary.
- `scaler_memory_search` searches memory candidates by query, tags, task id, and validity, returning summary references only.
- `scaler_memory_retrieve` retrieves memory content by id/path and scope (`summary`, `full`, or `section:<heading>`) and logs the retrieval.

Memory should hold details useful later while active context keeps only concise references. Summary-scoped task context memory items inject memory id/title/path/tags/summary rather than the full file; full scope must be requested explicitly.

Research reports can store raw evidence and long source excerpts in memory automatically; research reports keep only concise memory ids under `.scaler/research/reports.json`.
