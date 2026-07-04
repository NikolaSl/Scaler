---
id: scaler-core-principles-and-completion-direction-d99826b1
title: SCALER core principles and completion direction
source: user-session-2026-07-04
tags: completion,context,prd-ledger,safety,scaler-principles,traceability,validation
validity: active
createdAt: 2026-07-04T21:40:55.919Z
updatedAt: 2026-07-04T21:40:55.919Z
---

# SCALER Core Principles and Real Completion Direction

This memory captures user-stated priorities that must remain visible across session loss and context compression.

## Why this matters

SCALER is not only being built for this repository. The same mechanisms must be used by future SCALER jobs so customer work is traceable, focused, validated, and complete against its PRDs/specs.

## Core invariants

1. **Focused valuable input context**
   - Active context must contain only information valuable for the targeted task.
   - Avoid wasting context tokens on unrelated or generally related data.
   - Every context item should have a clear reason, scope, priority, exactness, and task/requirement link.
   - The task context should be as complete as possible for the task, but without broad irrelevant context.

2. **No Chinese whispers, no amnesia**
   - Compression must not distort meaning.
   - Exact data that may matter later must be externalized to memory/files and referenced, not lossy-summarized away.
   - Summaries must preserve source references, confidence/validity, and retrieval paths.
   - Knowledge may leave active context only after it is safely stored in durable memory/logs/artifacts.

3. **Full traceability and auditability**
   - Every action, decision, prompt, tool call, result, validation, report, safety decision, and commit should be logged.
   - A customer and SCALER itself must be able to reconstruct what happened, why it happened, what evidence was used, and how the result was validated.

4. **Atomic, debuggable, consistent tasks**
   - Tasks must be small enough to debug easily and validate independently.
   - Tasks must still be coherent and atomic; do not split into wasteful fragments.
   - One task should have a clear goal, Definition of Done, allowed paths/tools, validation plan, and evidence trail.

5. **Validation discipline and protection nets**
   - Each task needs Definition of Done, structured task report, validation evidence, and commit/skip evidence.
   - Whole developments need a complete validation plan: unit tests, mocked integration tests, real/acceptance workflow tests when applicable, plus security/CI checks where relevant.
   - Implemented features should not be accepted by claim; status must be backed by code, tests, docs, validation runs, and traceable commits.

6. **Spec detail protection**
   - No spec detail should depend on compressed conversation memory or manual review only.
   - Each PRD/spec clause should have a machine-readable requirement record, acceptance criteria, plan/task links, implementation evidence, test evidence, validation evidence, and derived status.
   - Missing evidence should automatically produce a gap/blocker.

7. **Minimal complete implementation, not bloat**
   - SCALER should satisfy PRDs/specs with the minimum feature set that is truly complete.
   - For small customer projects, agents must not bloat scope, architecture, dependencies, or token use.
   - Agents may add unrequested features only when needed to satisfy real specs/PRDs, security, validation, supportability, extension, or minimal completeness.

8. **Design for support and extension**
   - Agents should choose designs that are maintainable, supportable, and extensible while avoiding unnecessary complexity.
   - The architecture should make future changes and audits easier, not just pass the immediate task.

## Current strategic conclusion

The old gap set was closed, but a stricter review against `assignement.md` and all `specs/*.md` reopened source-spec gaps GAP-023..033. SCALER is therefore not yet truly complete. It has strong foundations, but still needs hard enforcement and machine-verifiable PRD/spec-to-code guarantees.

## Highest-priority next work

1. **GAP-023 P0: child-agent safety and allowed-tools defaults**
   - Child Pi agents must be deny-by-default or require explicit permission manifests.
   - Child agents that receive tools must load SCALER safety hooks/extension or run in approved isolation.
   - This is critical because child agents otherwise can bypass parent safety and allowed-tool constraints.

2. **Requirement Evidence Ledger**
   - Build a runtime/project ledger that maps source PRD/spec clauses to requirement records, acceptance criteria, tasks, code paths, tests, docs, validation runs, reports, commits, and open gaps.
   - Requirement status must be derived from evidence, not manually claimed.
   - Needed for SCALER development and for future SCALER customer jobs.

3. **Hard task-quality gates**
   - DoD, validation plan, allowed paths/tools, PRD refs, and task report should become blocking requirements or explicit waivers, not only warnings.

4. **Context-quality verifier**
   - Verify that active task context is focused, complete for the task, source-referenced, exact where needed, and free from unrelated bloat.

5. **Validation suite verifier**
   - Verify planned and executed tests across unit, integration, workflow/acceptance, security, and CI/sandbox gates as applicable.

6. Continue source-spec backlog GAP-024..033 after the P0 and ledger foundations.

## Desired completion definition for SCALER itself

SCALER should be considered really complete only when:

- Every assignment/spec requirement is represented in the evidence ledger.
- Every requirement has acceptance criteria and derived status.
- No requirement is marked implemented without code/test/doc/validation/commit evidence.
- Context minimization and memory externalization are enforced, not just prompted.
- Compression cannot lose exact important content without durable references.
- Child agents cannot bypass safety/tool permissions.
- Staged work, task execution, validation, replanning, logging, storage, budgets, and git progress are all traceable and enforced.
- Full unit, mocked integration, and real/acceptance workflow coverage passes.

