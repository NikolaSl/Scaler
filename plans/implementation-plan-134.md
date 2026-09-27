# PLAN-134 — Request-evidence proportional initial routing

## Reproduced gap

The current initial complexity selector treats English domain nouns such as
`docker`, `security` and `kubernetes` as high-risk authority by themselves and
treats request length above 500 characters as complex. Consequently, a simple
lookup such as `What is Docker?` enters the full PRD workflow, while an
equivalent complex Bulgarian change request can remain in lightweight
execution because the action vocabulary is English-only.

This is the explicit SC-04 failure recorded in the current requirements
coverage. It violates AC-04's boundary that language, domain vocabulary,
verbosity and length alone must not select the most expensive route.

Baseline: PR #24 candidate `e3d849c329d8376f8a68712acb2c7844f617602a`,
tree `5935fd05f2b3a32fe1b3d2c1004c52da5a181718`.

## Bounded next unit

1. Separate requested effect and orchestration evidence from incidental domain
   vocabulary. A question about a risky domain must remain a lightweight
   lookup; an actual sensitive external change can still select the full
   workflow.
2. Make equivalent English and Bulgarian requests select equivalent routes.
   Keep the fallback deterministic and local; do not claim general natural
   language understanding from a bounded bilingual regression set.
3. Remove raw request length as independent escalation authority. Repetition or
   verbosity without additional workstreams, dependencies, consequence or
   uncertainty must not force PRD.
4. Preserve the empty-request idle route and existing lightweight,
   workspace-change and genuinely high-consequence controls. Keep decision
   reasons auditable without copying the request or inventing authority.
5. Bind later escalation to measured runtime evidence through the existing
   adaptive assessment path; this unit only corrects the initial route and does
   not implement automatic decomposition, model selection or child execution.

## Commit and validation sequence

- Persist this plan, then a separate failing regression commit covering paired
  English/Bulgarian lookups, paired multi-part changes, domain-keyword
  questions, verbose lookups and positive change controls.
- Implement the smallest compatible evidence-based selector in a separate
  commit and add boundary/adversarial tests before documentation.
- Reconcile SC-04/AC-04 traceability without promoting unrelated P3 criteria.
- Run focused adaptive tests, TypeScript build, full unit/component, mock
  integration and conformance gates on the candidate. Perform own review before
  incorporating it into a phase PR.

## Pipeline and limits

Preparation only on `implementation/v2-p3-proportional-routing`, based on the
current PR #24 candidate; no second PR while #24 awaits a current-head Copilot
review. No model calls, paid provider, deployment, broad language classifier,
automatic task splitting, quality, savings or scale claim is in scope. Passing
the bounded bilingual cases will make SC-04 better evidenced, not prove general
multilingual semantic equivalence.

## Implemented evidence

Initial routing now distinguishes bounded information, workspace-change,
multi-workstream and external-effect requests. English and Bulgarian controls
cover direct imperatives, polite modals and explicit follow-on actions. Domain
and complex-work nouns, advisory or quoted action verbs, and raw length carry no
effect authority by themselves. Follow-on workspace, planning and deployment
steps cannot hide behind an informational prefix. Review hardening also binds
workspace verbs to request position, covers common create/edit/write forms, and
keeps response phrases, release-note nouns and Bulgarian `платформа` from
masquerading as external effects while preserving explicit email/payment
controls.

The selector remains a deterministic bounded vocabulary, not semantic language
understanding. General paraphrase coverage, justified isolated execution and
risk-triggered direction checks remain open, so SC-04 stays Partial.
