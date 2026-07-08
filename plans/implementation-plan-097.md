# Implementation Plan 097: Pi extension display name wrapper

## Gap
Pi's loaded-resource banner displayed SCALER as `[src]` because the package manifest loaded `./src/index.ts` directly. Pi derives compact extension labels from the loaded extension path, so a direct implementation-directory entrypoint hides the product name and makes startup diagnostics confusing.

## Scope
- [x] IMPL-366: Add a named Pi package wrapper at `extensions/scaler/index.ts`, point `package.json` at it, include wrappers in TypeScript build coverage, and update docs/tests so Pi displays the extension as `scaler` while preserving the existing implementation in `src/index.ts`.

## Validation
- Test-first: focused `test/extension-shape.test.ts` failed before `extensions/scaler/index.ts` and package-manifest update existed.
- `npm run build` passed.
- `node --test --import tsx test/extension-shape.test.ts` passed (`12/12`).

## Notes for future readers
This is a packaging/display fix, not a runtime behavior rewrite. Keep implementation code in `src/index.ts`; keep the package/CLI loading path under `extensions/scaler/index.ts` so Pi's compact extension label remains product-oriented.
