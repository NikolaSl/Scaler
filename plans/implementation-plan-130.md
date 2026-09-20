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
3. Preserve each path's current tool grants, model selection, timeout, prepare
   mode, structured result ingestion, usage accounting and execution-lock
   ownership.
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
- existing research internet grants, report/proposal/schema ingestion, prepare
  mode and workflow integrations remain green.

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
