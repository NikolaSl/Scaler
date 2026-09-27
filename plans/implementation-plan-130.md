# PLAN-130 — P3 remaining child-launch prompt and provider admission

## Observed prerequisite gap

PLAN-129 protects the shared stage-agent path, but five existing child-launch
paths can still dispatch a final prompt without runtime-owned prompt-size
admission or strict provider admission:

- research-agent execution;
- diagnostic debug-agent execution (distinct from debug retry);
- replanner-agent execution;
- tool-schema discovery;
- the explicit `scaler_spawn_task` child launch.

Bounded reproductions on the PLAN-129 candidate passed prompts estimated above
13,500 tokens to the first three runners with `providerAdmission` absent. The
schema-discovery and direct-spawn requests construct the same unprotected child
request shape. These are live model-call boundaries, so closing them precedes
new routes, semantic planning changes or model-quality work.

## Bounded unit

1. Apply the existing final-prompt token allowance to all five child-launch
   paths. Refuse non-positive, non-finite and oversized prompts before runner
   dispatch or publication of a prepared/successful child run.
2. Attach the existing runtime-owned strict provider policy to the exact request
   used to render and execute each child invocation.
3. Preserve supported built-in/SCALER tool grants, model selection, timeout,
   prepare mode, structured result ingestion, usage accounting and
   execution-lock ownership. Refuse external extension-backed tool names that
   the strict isolated loader cannot actually provide.
4. Keep refusals fail closed: no runner call, no misleading successful/prepared
   run record and no downstream report/proposal/schema mutation.
5. Keep the provider hook authoritative for the complete live request envelope,
   supported API and actual model context window; do not duplicate provider
   estimation in these callers.

## Test-first evidence

- oversized generated research, diagnostic debug and replanning prompts refuse
  with zero runner calls and no child-run publication;
- oversized schema-discovery and direct-spawn prompts refuse before dispatch;
- invalid allowances refuse consistently and release any acquired execution
  lock;
- exact-boundary prompts remain admissible without dropping required content;
- each admitted runner request carries the strict provider policy and its
  rendered invocation suppresses ambient extensions, skills, templates and
  context files;
- supported tool grants, report/proposal/schema ingestion, prepare mode and
  workflow integrations remain green; browser/MCP extension grants refuse
  before dispatch until a trusted capability transport exists.

Run focused auxiliary-agent, schema-discovery, spawn-task, stage-workflow and
debug-conductor tests, then build, the full unit/component suite, mock integration
and conformance/autopilot gates. Two independent GPT-6 Astra/high reviews inspect
the exact final tree.

## Explicit limits

This unit does not classify task complexity, prove minimal-plan necessity,
automatically split tasks, add missing route adapters, wire a production
continuation supplier, bind an exact parent-selected provider/model identity or
claim local-model quality, savings or scale. It establishes admission parity at
the remaining child-launch boundaries; SC-04, SC-05, SC-07 and SC-08 therefore
remain partial until their separate behavioral and real-host evidence exists.

## Implemented evidence

The three generated auxiliary prompts now use the shared final-prompt admission
boundary before prompt audit, child-run publication or runner dispatch. Tool
schema discovery and `scaler_spawn_task` use the same boundary before preparing
or executing a child. Every admitted request carries the runtime-owned strict
provider policy, so the rendered child invocation suppresses ambient resources
and loads the provider-admission hook for the final live envelope.

Focused regressions cover all five bypasses, exact-boundary and one-token-under
decisions, malformed allowances, zero audit/run publication on auxiliary-agent
refusal, supported tool contracts and strict prepare-mode invocation. Review
fixes also keep token allowances runtime-owned, avoid charging refused spawns,
reject unavailable external grants, classify terminal Pi JSON abort/error as
failure despite exit zero, and preserve successful retry recovery. The exact
candidate passes build, `git diff --check`, 1,008/1,008 unit/component tests,
67/67 mock integration tests and 7/7 conformance/autopilot checks.

This evidence closes the reproduced child-launch admission gaps only. Parent
interactive model calls, provider-internal retries, alternate provider payloads,
exact tokenization and observed-usage reconciliation remain open, so SC-05 and
AC-05 are not claimed complete.

Strict children currently load only Pi built-ins plus the SCALER extension.
Browser/MCP/custom extension tool names therefore fail closed rather than being
advertised in prompts without an active implementation. This unit does not add
the missing trusted external-capability adapter.
