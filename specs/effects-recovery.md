# External Effects and Retry Reconciliation
Requirements: SC-14. Acceptance: AC-14.

## Effect classes

Every action with an effect MUST declare whether it is read-only, repeatable,
idempotent using a supported key, reversible/compensatable, or non-idempotent.
Do not infer safety solely from HTTP method, tool name or an agent's claim.

Persist a scoped intent and operation identity before issuing an effect, then
record observed completion evidence. Include task/attempt, target, authorization
and redacted arguments. Cancellation/timeouts may leave an unknown outcome.

## Recovery

If interruption occurs after dispatch but before acknowledgement, reconcile via
a provider idempotency key, operation/status lookup, resulting artifact/commit
identity or another verified probe before retry.
If safe reconciliation is impossible, pause with outcome=unknown and the exact
unresolved operation. Do not claim exactly-once execution across arbitrary tools.

Never replay a non-idempotent effect merely because the agent report is missing.
Compensation is itself an authorized effect with an outcome; it is not assumed
possible or automatically safe. Report partial effects and cleanup failures.

Git commit creation also requires reconciliation after interruption. Publication,
messages and remote mutation retain their separate permission boundaries.
