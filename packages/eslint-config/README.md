# ESLint config (`@workspace/eslint-config`)

## Role in the architecture

The narrow ESLint layer next to Biome. Biome formats, orders imports and runs the base
lint; this config adds only what Biome cannot check: blank lines between statements,
hexagonal layer boundaries, type-aware promise rules, the type-aware rules that stop
an untyped (`any`) value from spreading or a deprecated API from being used, the must-use-Result rule, immutability
rules for domain and application code, one class per file everywhere, one exported
function or class per file in domain and application code, imports that enter a folder
with an `index.ts`, or a module, only through its index, and no raw `<input>`, `<textarea>`
or `<select>` in views (`react/forbid-elements` under `presentation/`): the kit's `Input`,
`Textarea` and `Select` track unsaved input, a raw field would not. It never formats tokens. Tests
(`*.spec.*`) may cross layers: like the composition root, they wire real adapters and
generated models. A fixture (`__fixtures__/`) is test data, which no rule of the base reads; the
UI contract's roles, routes and invariants' numbers, which test data names too, are refused by hand there as
everywhere (`contractTerms`).

Type-aware rules run on TypeScript 6 (the `lint` catalog), because TypeScript 7 does not
ship the JavaScript compiler API that typescript-eslint needs.

## Key exports

- default / `base`: the flat config array used by the root `eslint.config.js`.
- `ignores`: the shared ignore block.
- `workspace/must-use-result`: reports a discarded neverthrow `Result` or `ResultAsync`.
- `workspace/one-unit-per-file`: in domain and application code, reports a second exported
  function or class in a file; types, constants, schemas and private helpers are free.
- `workspace/import-through-index`: reports an import that reaches inside a folder with an
  `index.ts` from outside it, or inside a module of a module root that has no index yet;
  every static import form counts (declarations, re-exports, `import()` types, dynamic
  imports of a literal), resolved by TypeScript (workspace packages to their source, a
  relative `.surql` at its path), fixtures exempt.
- `workspace/contract-terms`: reports a role or a route of the UI contract written by hand as a
  string where the code expects one, by TypeScript's type at the string (made of string literals
  that are all roles, or all routes); with `routeValues`, also any string, part of a template or
  regular expression that names a route by its value; and a number of an invariant written by
  hand where the code expects a property of `CONTRACT_INVARIANTS` (an object typed by an
  invariant's numbers, whole or picked), read from where the module declares that property. It
  reads the roles, routes and invariants' numbers from the module `ui-contract emit terms`
  writes (`module`), and fails the lint when that module is missing or malformed
  (`contract/REFERENCE.md#rule-terms`).
- `contractTerms({ module, files, routeValues })`: the config blocks of that rule over `files`,
  fixtures included, and by value over `routeValues.files` but its `ignores`; the root
  `eslint.config.js` uses it.
- `importBoundaries({ modules, reachIn })`: the config block that gives the rule the
  repository's module roots (with their `flat` and `outside` folders) and its `reachIn`
  entries (a folder or one file that may still import inside another folder), by absolute
  path; the root `eslint.config.js` uses it.

## Commands

- `bun run test`: rule tests and fixture-based config tests.
- `bun run lint`.
