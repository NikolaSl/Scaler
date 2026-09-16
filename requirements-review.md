# Requirements Revision 2 — Review Guide

## Outcome

The proposal retains SCALER's purpose: autonomous, economical, focused execution
of complex work, including local-model operation, with durable evidence and
controlled recovery. It removes mandatory mechanisms that do not always help.

Read [assignment](assignement.md), then [27 requirements](requirements-catalog.md).
Each has a corresponding [acceptance scenario](specs/acceptance-scenarios.md).
The [coverage assessment](dev-progress-tracker/requirements-v2-coverage.md) explicitly
separates existing foundations, observed failures and unassessed behavior.

## Decisions captured from this review

| Topic | Revision 2 decision |
|---|---|
| Planning | Required before execution, proportional in detail; one-task plans are valid |
| Stage I–IV | Optional workflow template; activities may be skipped, revisited or combined when justified |
| Agents | A means of isolation/capability, not a target count or one-per-task obligation |
| Tool/MCP execution | Direct deterministic, current-agent, or isolated tool-agent routes |
| Large MCP | Measure actual selected schema/docs/result footprint relative to the chosen model's remaining envelope |
| Infrastructure | Provider capabilities; Docker/Compose/Minikube are optional examples |
| Local models | Document and test a supported local-only envelope; no silent cloud escalation |
| Parallelism | Existing one-operation-per-workspace policy retained; future opt-in is outside scope |
| Quality | Current output-bound evidence plus integration/requirement acceptance |
| Memory | Exact sources, scoped retrieval, source versions and invalidation |
| Recovery | Reconcile state, processes, Git and uncertain effects before retry |
| Git | Accepted project outputs and compact audit history; large evidence retained separately by policy |
| Comparison | External-agent baseline is not required; begin with absolute scenarios and self-measurement |
| Coverage | A module/test name is not proof; no revision 2 requirement is claimed Verified yet |

## Why tool routing is request-specific

A server with many tools can expose one small useful schema. Conversely, a small
schema may return huge data or need extensive specialist documentation.
The route therefore uses selected schema/guideline tokens, needed documentation,
bounded result size, expected iterations and caller context headroom.
Fingerprint-based profile caching avoids repeated discovery. Unknown sizes use
bounded inspection or explicit conservative assumptions.
Isolation must justify its setup, transfer and report cost; known exact operations
can execute without another LLM call.

## Guarantees versus mechanisms

Core guarantees are authority, contracts, planning/dependencies, context admission,
evidence, recovery, permissions, bounded resources and honest completion.
Host/model adapters, environment providers and domain validators implement them.
Embeddings, containers, stronger reviewers, parallel execution and multiple model
routing are not required just because they are possible.

The specs describe logical records and observable behavior. They do not select a
database, event-sourcing architecture, message broker, module layout or process
hierarchy. This prevents requirements cleanup from prematurely becoming a rewrite.

## Status and next phase

This change is documentation only. Source code, package dependencies and test
implementation are unchanged. Existing manual behavior is retained with notices.
Old PRD-* IDs map to SC-* requirements and historical matrices remain available.

After requirements review, architecture work should choose the smallest design
that satisfies the admission/acceptance/recovery guarantees, then map migration
steps and regression fixtures. Do not add every optional provider first.

Implementation proposals must define concrete defaults and measurable limits for
the chosen model/host envelope, routing thresholds, retention and scale fixtures
before claiming acceptance. These configurable engineering choices do not block
review of the product guarantees.

## Verification scope

Document integrity checks must cover SC/AC/coverage one-to-one mapping, all legacy
IDs mapped, specification links/anchors and documentation-only diff.
The existing conformance test checks legacy PRD-* structure only and must not be
used as revision 2 certification. Real model behavior and architecture migration
remain future work.
