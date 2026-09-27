# PLAN-148 — P3 exact imported-caller discovery

## Status

Planned on the P3 preparation branch; implementation and validation pending.

## Observed prerequisite gap

PLAN-146 can resolve an explicitly named imported callable to its exact exported
definition. It cannot identify the bounded top-level caller that uses that
binding, so a caller investigating one known local edge must still approve a
whole source file or perform a workspace-wide same-name search.

The installed Pi host can dynamically select current-agent tools but exposes no
API for programmatically executing a tool as the current agent. Completing that
route safely requires a separate provider/tool lifecycle protocol and is not
folded into this context-discovery unit.

## Bounded unit

1. Recognize only an explicit
   `import-caller:<specifier>#<exportedIdentifier>` candidate query. Empty,
   padded, malformed, non-relative or extensionless parts fail closed without
   falling back to generic search.
2. Search the existing bounded allowed-path JavaScript/TypeScript source set.
   Accept only parser-backed, value-level static named imports whose literal
   specifier and imported source name match exactly; map an alias to its exact
   local binding. Re-exports, default, namespace, type-only, dynamic and
   CommonJS edges are outside this unit.
3. Emit only unique top-level named function declarations or single callable
   variable statements whose own executable body contains a direct call through
   that imported local identifier. Calls inside nested functions/classes and
   property/element/optional/new/tagged uses do not establish this edge.
4. Bind every candidate to its source path and the existing
   `typescript-function` selector. Discovery remains read-only; explicit
   candidate approval is still the only manifest mutation boundary.
5. Preserve all existing selector and generic discovery behavior.

## Test-first evidence

- an exact named import discovers, approves and resolves only its top-level
  caller bytes;
- aliased imports map source export names to local call identifiers;
- multiple callers remain distinct choices and duplicate evidence is deduped;
- malformed sources and queries, type/default/namespace/dynamic/CommonJS edges,
  shadowed nested calls, property/new/tagged uses and ambiguous caller selectors
  fail closed;
- unrelated changed files cannot starve bounded allowed-path discovery;
- existing discovery modes remain unchanged.

Run focused context tests after meaningful changes, then the full TypeScript
build, unit/component, mock-integration, conformance/autopilot and diff gate.

## Explicit limits

This unit is syntactic one-hop discovery, not TypeScript symbol resolution. It
does not follow re-exports, overloads, package resolution, inferred extensions,
default/namespace imports, higher-order aliases, assignments, methods, class
members, recursion across files, natural-language inference, automatic
approval, task decomposition, model execution, quality or savings evidence.
SC-07/AC-07 remains Partial.
