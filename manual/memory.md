# Memory

Scaler stores external memory under:

```text
.scaler/memory/
```

Current files:

- `.scaler/memory/index.json` — memory metadata index.
- `.scaler/memory/<memory-id>.md` — stored memory content.

Implemented tools:

- `scaler_memory_write` writes a memory file and index entry.
- `scaler_memory_retrieve` retrieves memory content by id/path and logs the retrieval.

Memory should hold details useful later while active context keeps only concise references.

Research reports can store raw evidence and long source excerpts in memory automatically; research reports keep only concise memory ids under `.scaler/research/reports.json`.
