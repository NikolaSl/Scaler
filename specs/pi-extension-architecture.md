# Host Integration Requirements — Pi First
Requirements: SC-25. Acceptance: AC-25.

## Scope

Pi remains the initial integration target. This document specifies required
adapter behavior, not the next architecture or source-file layout.
Additional host adapters are optional. No new framework is required by revision 2.

## Host capabilities

Inspect/document actual support for model invocation, structured reports,
tool discovery/selection, context accounting, bounded outputs, usage events,
cancellation/process lifecycle and persistent session metadata.
Capabilities MUST be tested against the supported host version, not only a mock.
Unavailable capabilities need a documented safe restriction or explicit blocker.

For the currently reviewed Pi API, tool discovery/selection belongs to
ExtensionAPI (pi.getAllTools/getActiveTools/setActiveTools), not ExtensionContext.
Validate this contract for the supported version during implementation.

## Isolation and authority

A child must receive the intended task context, tools and permissions without
unintended parent history or unrelated auto-loaded extensions/prompts.
Audit/account for any host-injected system content, project instructions, schemas
or hooks. Loading a full supervisor extension into a child is not a requirement;
the child needs enforced worker boundaries and reporting.

Direct commands, hooks, current-agent tools and isolated workers MUST preserve the
same acceptance, state, scope, budget and recovery rules.
Interactive and unattended modes MUST agree on authority. Lack of a UI must
produce a recoverable pause for a necessary decision, not a hang or silent grant.

Exact process topology, database, transport, extension composition, CLI migration
and module boundaries are deferred to the architecture phase.
