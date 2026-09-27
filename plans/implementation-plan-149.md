# PLAN-149 — P3 exact one-re-export caller discovery

## Status

Planned on the P3 preparation branch; implementation, validation, phase review
and merge remain pending.

## Observed prerequisite gap

PLAN-148 finds top-level callers when a source imports the requested callable
directly from its defining module. A common local barrel edge remains invisible:
the caller imports a named value from one local module that directly re-exports
the callable from a second local module.

## Bounded unit

1. Recognize only an explicit
   `reexport-caller:<barrelSpecifier>#<exportedIdentifier>` query. Empty,
   padded, malformed, non-relative or extensionless values fail closed without
   generic-search fallback.
2. Require an exact parser-backed value-level named import from the barrel and
   map its source name to the exact local alias used by the caller.
3. Require the stable regular barrel to contain exactly one direct value-level
   named re-export for that public identifier. Its source must be another
   extension-explicit relative local source within workspace/task scope.
4. Require the stable final target to contain exactly one direct exported
   top-level callable matching the re-exported source identifier.
5. Emit only unique top-level function/callable-variable selectors whose own
   executable body directly calls the imported local alias. Candidate approval
   remains the only manifest mutation boundary.
6. Preserve all existing selector and discovery behavior.

## Test-first evidence

- an exact named import through one aliased named re-export discovers, approves
  and resolves only the top-level caller bytes;
- public-name and local-alias changes remain bound to their exact edge;
- duplicate or conflicting re-export evidence fails closed;
- default, namespace, type-only, star, indirect, dynamic and CommonJS edges fail
  closed;
- malformed, escaping, extensionless, queried, fragmented and symlink-backed
  barrel/target evidence fails closed;
- nested, shadowed, property, optional, constructed and tagged uses do not
  establish a caller edge;
- unrelated changed files cannot starve bounded allowed-path discovery.

Run focused context tests after meaningful changes, then the TypeScript build,
unit/component, mock-integration, conformance/autopilot and diff gate.

## Explicit limits

This unit follows exactly one syntactic named re-export hop. It does not resolve
package aliases, inferred extensions, export-star chains, multiple/recursive
barrels, TypeScript symbols or types, higher-order aliases, assignments,
methods, classes, natural-language inference, automatic approval, task
decomposition, model execution, quality or savings evidence. SC-07/AC-07
remains Partial.
