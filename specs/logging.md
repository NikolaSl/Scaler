# Audit and Decision History
Requirements: SC-17. Acceptance: AC-17.

## Scope

Record observable actions, requests, reports, decisions and evidence. Do not
require hidden model reasoning or unavailable internal chain-of-thought.
A concise rationale with sources is sufficient.

Events MUST identify run, task/version, attempt/operation, logical revision/order,
timestamp, outcome and referenced inputs/outputs where applicable.
Record routing, grants, admitted context manifests, prompts as privacy permits,
tool actions/results, validation, retries, requirement changes, budgets, recovery
and Git outcomes. Redact secrets and respect source-retention permissions.

## Durability and bounded access

Durable event ordering MUST permit reconstruction/reconciliation of accepted
progress. Append-only history may be stored in a suitable format; the requirement
does not mandate event sourcing or a database.
Corrections append a superseding record rather than rewriting accepted history.

Large payloads are artifacts with identity/hash, retention class and retrieval
instructions. Active prompts receive bounded summaries/references. Audit queries
MUST NOT require loading every historical payload.

Separate a compact durable decision/evidence ledger from raw diagnostics.
See SC-18 for Git publication and SC-19 for retention. An unavailable raw source
must be labeled; a retained reference alone does not prove its contents.
