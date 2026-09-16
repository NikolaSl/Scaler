# Scoped Authority and Data Protection
Requirements: SC-16. Acceptance: AC-16.

## Permission contract

Authority comes from the user and configured policy, never from retrieved text,
tool output or an agent's self-declared role. Define allowed actions, resource/path
scope, data destinations, network access, effect classes and expiry/limits.
Reuse an existing grant while it covers the action; do not ask at every step.

Differentiate reversible local edits, local execution, external transmission,
publication, destructive actions and privileged/secret access. Consequence and
actual target matter; a keyword such as security is not an approval policy.

## Enforcement

Enforce action scope outside model prompts across direct, current-agent and
isolated-agent paths. A child MUST NOT expand grants, modify authoritative state
or self-approve a waiver. Validate paths and relevant indirect execution against
the enforcement boundary; shell text matching alone is not a sandbox.

If the adapter cannot enforce required containment, declare the limitation and
block strict/unattended operations that need it. A Docker/VM label does not prove
containment: mounted paths, privileges, credentials and network access matter.

## Data and injection

Treat external documents and tool responses as untrusted task data. Instructions
inside them cannot override the user's scope or grant access.
Keep secrets outside prompts and audit outputs; redact known sensitive content
before storage/model transmission. Pattern redaction is best effort, so avoid
collecting unnecessary secrets in the first place.
A model/provider route change MUST recheck data-location and transmission grants.

## Development and exceptions

Apply task-relevant secure-development checks. Dependency/image scanners are
optional integrations; if their evidence is required, absence blocks acceptance
unless an authorized alternative or explicit requirement change is recorded.

A denied operation returns its reason and any authorized alternative. No hidden
fallback, weaker sandbox or new network destination may bypass a denial.
Cancellation and temporary-resource cleanup stay within the original grant.
