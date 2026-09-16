# Versioned Memory and Provenance
Requirements: SC-06. Acceptance: AC-06.

## Record

Memory stores reusable evidence and findings outside active context.
Each item MUST identify its source, source version/hash or retrieval timestamp,
scope, task/requirement links, exact artifact reference, concise description,
validity and known limitations. Claims and summaries MUST identify supporting
sources and important inference/uncertainty.

Validity distinguishes current, stale, obsolete and unknown. A label is not
evidence of freshness. For mutable sources, define a freshness/revalidation rule.

## Invalidation

Track the source dependencies needed to detect material change. When a referenced
file, requirement, schema, environment or external fact changes, mark affected
derived findings for revalidation before relying on them. Historical evidence
remains intact; it is not rewritten to match current conclusions.

Cache reuse MUST check version, authority/data scope, relevant inputs and
freshness. Cached tool documentation MUST be keyed by server/tool schema version
or a checked fingerprint; if unavailable use an explicit revalidation policy.
Repeated retrieval need not create new LLM summaries.

## Retrieval

Support references plus scoped exact content as required by SC-07.
Large objects remain outside context, but MUST be retrievable while supporting
active work or retained acceptance evidence.
A missing/expired artifact MUST be reported, never silently replaced with a
summary presented as its exact source.

File storage is sufficient for the initial profile. Vector databases, embeddings,
cross-project memory and automatic memory curation are optional.
