# PLAN-161 — P3 context-process acceptance reconciliation

## Reassessment

SC-07 requires a focused worker to be able to ask for necessary information by
exact source/selector or by a pathless missing-data question. The supervisor
must validate scope, authority, source identity and the complete next request
before resuming the same task. PLAN-151 and PLAN-155 through PLAN-159 already
implement and exercise that process, including exact section delivery,
unknown-source research, bounded candidate/summary delivery, truthful refusal,
automation continuation and declared 32K/128K windows.

The remaining items previously listed against SC-07—natural-language selector
inference, recursive semantic graph traversal, automatic supervisor choice and
a configured local-model run—are not additional SC-07 requirements:

- the model proposes the needed source, selector or missing-data question;
- the supervisor validates the proposal rather than choosing context for it;
- optional semantic retrieval may improve discovery but is not required when
  bounded candidate search and exact follow-up retrieval are available;
- configured local-host execution belongs to SC-09/AC-09 and P7 evidence, not
  to the model-independent SC-07 process boundary.

## Minimal unit

1. Re-run the existing exact-section, unknown-source, varied-window and
   automation-continuation scenarios without adding production machinery.
2. Reconcile SC-07/AC-07 documentation to the implemented model-proposal and
   supervisor-validation contract.
3. Keep unsupported claims explicit: the deterministic fixtures establish FSM
   behavior, not source truth, model quality, token savings or local-host
   suitability.
4. Leave SC-08 and SC-09 status unchanged. In particular, do not approximate
   the installed isolated caller-continuation envelope: Pi's command context
   does not expose a guaranteed final provider payload after all extension
   transformations.

## Validation

Run the focused context, missing-context, conductor and automation tests; the
two unknown-source integration scenarios; build; the full unit/mock-integration
and conformance gates; and `git diff --check`. A documentation-only correction
is sufficient if all existing executable evidence still passes.

## Explicit limits

This unit does not add semantic search, automatic task/context selection,
another routing layer, a local model, a provider adapter or a quality benchmark.
Task decomposition remains P4. Real configured local-only operation and its
resource envelope remain SC-09/P7 evidence.

## Outcome

The existing worker-proposed exact-source, exact-selector and pathless-question
paths pass their positive and negative controls. Independent review found one
remaining exception, which this unit closes minimally: cited file-backed local
research sources are captured with a runtime-owned SHA-256 fingerprint, checked
against task path scope and persisted as required reference bindings for
freshness revalidation before retry. Every cited local source must be file-backed;
summary-only or mixed unbound claims block. Resolved bindings and their
admissible reports are revalidated, and stale, conflicting, incomplete,
unresolved or oversized context is removed before the task is blocked again.
The selected research request, task and question identity is checked at agent
ingestion and cannot be retargeted through an existing report ID. Research
children receive inspection tools but no direct report-ledger write tool, so
their only admitted result is that bound structured final event.
Out-of-scope, absent and changed sources block without injecting the claim.
Leaf and ancestor symlinks are refused before source bytes are read by matching
the opened descriptor to a fresh direct-path identity. Unrelated report updates
cannot rebaseline inherited source fingerprints. Uncited metadata is omitted.

The exact-tree candidate passes the TypeScript build, 1,185/1,185
unit/component tests, 72/72 mock integration tests, 10/10
conformance/autopilot tests, 173/173 focused
context/missing-context/conductor/automation tests, 4/4 focused unknown-source
and varied-window scenarios, and `git diff --check`. SC-07/AC-07 is Verified at
the model-independent process boundary. SC-09 and real local-host evidence
remain separate.
