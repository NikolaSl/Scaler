# SCALER Storage Management Spec

## Purpose

External memory and logs protect active context, but they must not grow without control.

Scaler must run reliably on normal developer machines and avoid filling disk space.

## Principle

Tokens are expensive, disk is cheaper, but disk is not unlimited.

Scaler should preserve auditability while using compression, rotation, indexing, and retention policies.

## Storage scope

Managed Scaler data lives under `.scaler/`:

- `.scaler/state.json`
- `.scaler/memory/`
- `.scaler/logs/`
- `.scaler/artifacts/`
- `.scaler/cache/`

Scaler must never rotate or delete project files outside `.scaler/`.

## Storage budget

Storage limits should be configurable and coordinated with `specs/budgets-watchdogs.md`.

Recommended controls:

- soft limit: start compression/rotation and warn
- hard limit: pause execution before disk becomes unsafe
- minimum free disk threshold: pause if free disk is too low

When a hard limit is reached, Scaler should pause and report:

- current storage usage
- largest files/folders
- safe cleanup options
- what data would be compressed, archived, or removed

## Compression

Large logs, tool outputs, and old memory files should be compressed when they are not active.

Use stream compression for large files so Scaler does not load them fully into memory.

Compressed files must remain indexed and retrievable.

## Rotation and retention

Logs should be append-only during active writing, then rotated by size, age, or run/task boundary.

Retention policy should prefer:

1. Keep current run active logs uncompressed when useful.
2. Compress older logs.
3. Keep summaries and indexes for archived logs.
4. Delete only cache/temp data automatically.
5. Delete raw logs or memory only when policy allows or user approves.

## Large outputs

Large tool outputs should not be injected into active context.

They should be stored as files with:

- short summary
- file path
- size
- hash when useful
- related task/run
- retrieval instructions

## Deduplication

When useful, Scaler should avoid storing duplicate large content by hashing files or outputs and referencing existing copies.

## Stability rules

- Check disk usage periodically during long runs.
- Never continue writing until disk is full.
- Prefer pause over data loss.
- Keep indexes small enough to load quickly.
- Do not read large archives fully unless explicitly requested.
