# PLAN-155 — P3 exact-section missing-context delivery

## Observed gap

PLAN-151 makes an explicit file request durable required context, but it always
adds the complete file. A worker that knows the exact Markdown heading or
top-level JavaScript/TypeScript callable cannot request only that bounded source
through the missing-context retry path. This can unnecessarily exhaust or
distract a small local model even though the exact selector boundary already
exists.

## Bounded unit

1. Accept one explicit selector directive in the reported missing-data text,
   alongside the existing backtick-quoted source path:
   `heading:<exact text>` or `function:<exactIdentifier>`.
2. Persist the requested path plus the existing exact selector as required
   `section` context before resolving or unblocking the request.
3. Delegate extraction, ambiguity, parser, size and stable-source checks to the
   existing context resolver. Malformed, duplicate, unsupported or ineligible
   selectors fail closed without manifest publication or task unblocking.
4. Preserve full-file behavior when no selector directive is present and keep
   all existing path-scope and direct-regular-file checks.

## Test-first evidence

- exact Markdown and function requests deliver only the selected bytes to the
  next worker prompt;
- following peer sections and unrelated declarations are excluded;
- malformed, duplicate, missing, ambiguous and oversized sections do not
  resolve the request or publish required context;
- ordinary full-file requests remain unchanged.

Run focused missing-context/context/conductor tests, then build, the full unit,
mock integration, conformance/autopilot and diff gates.

## Explicit limits

This unit does not infer a path or selector, choose among candidates, perform
semantic search, decompose a task, or claim any model quality or token saving.
The local model/operator names the source and selector; the supervisor validates
and freshness-binds the exact bytes. SC-07/AC-07 remains Partial.
