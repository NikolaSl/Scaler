# SCALER Research and Information Quality Spec

## Purpose

Project success depends on the depth and quality of information gathered from local project data and the outside world.

Scaler must distinguish signal from noise, preserve evidence, and define when research is complete enough for planning or execution.

## Principle

Research is evidence collection, not context dumping.

The active context should contain conclusions, confidence, and evidence references. Raw pages, long notes, and noisy search results should be stored in memory/logs and retrieved only when needed.

## Pi integration options

Scaler can use several research mechanisms depending on what is configured:

- Pi skills, such as Brave Search or browser/search skills.
- Custom Scaler research tools registered by extension.
- MCP search/browser/documentation servers when available.
- Browser automation tools when available.
- CLI/network tools such as `curl` only when safe and allowed.
- Local project search, docs, logs, dependency metadata, package lockfiles, and source code.

If internet tools are unavailable, Scaler should report the limitation and continue with local sources or request setup.

## Research agents

Research can be executed by the current coordinator/task agent for simple lookups.

For non-trivial, independent, risky, or large research questions, Scaler should spawn separate research agents with isolated context.

Stage II knowledge collection should act as a research coordinator when multiple research tasks are needed:

1. Extract research questions.
2. Group or split them by topic, risk, and dependency.
3. Spawn research agents only when isolation improves quality or focus.
4. Merge reports, deduplicate findings, and resolve contradictions.
5. Produce the final knowledge report for planning.

This avoids overloading one knowledge agent while also avoiding unnecessary agent spawning for simple research.

## Research flow

For each research task:

1. Define the question and why it matters.
2. Search local project sources first.
3. Search external sources when local data is insufficient and internet is allowed.
4. Prefer primary and version-matched sources.
5. Extract evidence into structured notes or memory files.
6. Compare sources and resolve contradictions where possible.
7. Produce conclusions with confidence and references.
8. Report unresolved unknowns explicitly.

## Source quality ranking

Prefer sources in this order:

1. Project source code, tests, configs, and local docs.
2. Official vendor/framework/library documentation for the exact version.
3. Standards, specifications, RFCs, laws, contracts, or primary references.
4. Source repositories, changelogs, release notes, issue trackers.
5. Trusted security databases and advisories.
6. Reputable technical articles with clear evidence.
7. Forums, Q&A, blogs, and generated content only as weak hints.

Low-quality/noisy sources should not drive decisions unless confirmed by stronger sources.

## Signal vs noise criteria

Treat information as stronger signal when it is:

- directly relevant to the research question
- from a primary or trusted source
- version/date compatible with the project
- supported by multiple independent sources
- consistent with local project evidence
- specific enough to guide implementation or validation
- reproducible locally

Treat information as noise or weak evidence when it is:

- generic, outdated, SEO-like, or AI-generated without sources
- version-mismatched
- contradicted by local code or official docs
- copied without evidence
- unrelated to the exact task
- too vague to validate

## Completeness criteria

A research task is complete when:

- each required question has an answer or an explicit unresolved status
- key conclusions have evidence references
- important contradictions are resolved or documented
- version-sensitive facts are matched to the project version
- implementation-critical APIs/formats are preserved exactly when needed
- enough information exists to plan or execute the dependent task
- remaining uncertainty and risk are stated

For high-risk tasks, require stronger evidence and independent confirmation.

## Research report

A research report should include:

- research id
- related PRD requirement/task
- questions investigated
- sources checked
- conclusions
- confidence level
- evidence references
- contradictions and resolution
- unresolved unknowns
- recommendations for planning/execution
- memory/log references

## Deep research

Deep research is used when normal research is insufficient for important decisions. It is on-demand, not default.

Use deep research for:

- architecture choices
- security-sensitive decisions
- unfamiliar stacks
- dependency/container risk
- unclear external APIs
- compliance/legal/standards questions
- repeated execution failures caused by missing knowledge

Deep research may use multiple search queries, source comparison, official documentation extraction, local validation, and separate research task agents.

## Context and storage

Research outputs should be stored as structured memory files under `.scaler/memory/` when they are useful later.

Raw search results, pages, and long extraction logs should be stored by reference and managed according to `specs/storage.md`.

## Safety

Internet research must follow `specs/safety-permissions.md`.

Do not send secrets or private code to external services unless explicitly allowed by policy.

## Logging

Log searches, sources, decisions, contradictions, confidence, and research completion according to `specs/logging.md`.
