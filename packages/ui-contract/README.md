# UI contract (`@workspace/ui-contract`)

## Role in the architecture

The contract between the user interface and everything that drives it: tests, agents and
the people who model screens. It holds the anchor grammar every `data-testid` follows
(2 to 5 dot-separated kebab-case segments: the screen name first, the kind last, as in
`user.sign-in.email-input`) and the tooling around the `contract/` folder at the root. The
`./anchors` subpath is pure and browser-safe, so views and the UI kit may import it; the
root export is build-time tooling for Bun.

## Key exports

- `.`: the tooling, for Bun.
  - Loaders of the three contract files, each returning problems (`file:line: message`
    through `formatProblem`): `parseVocabulary(markdown)` (the closed lists of
    `contract/vocabulary.md`, one `## ` section each, `VOCABULARY_SECTIONS`),
    `loadScreens(root)` (`contract/screens.json` through `screensFileSchema`, problems named
    by JSON path) and `loadModel(root)` (`contract/model.schema.json`, checked against the
    JSON Schema 2020-12 meta-schema, then each `$defs` entity through
    `entityDefinitionSchema`). The paths: `CONTRACT_DIR`, `VOCABULARY_FILE`, `SCREENS_FILE`,
    `MODEL_FILE` and the three schema files.
  - The Zod sources of the files: `screensFileSchema` and its parts, `flatJsonSchema` (route
    `params` and `search`), `scenarioSchema`, `entityDefinitionSchema`, `manifestSchema`.
    `SCHEMA_OUTPUTS`, `writeSchemas(root)` and `schemaDrift(root)` turn them into the
    committed `contract/*.schema.json` (generated; Biome leaves them as written).
  - Ajv for JSON Schema 2020-12: `createValidator()`, `jsonSchemaProblems(file, schema)`,
    `validateAgainst(file, schema, data)`.
  - `referencesIn(text)`: the bracket references of a scenario's text (`[anchor]`,
    `[/route]`, `[code:x]`, `[state:x]`, `[value:x]`).
  - The contract check: `checkContract(root)` loads the three files (stopping at their own
    problems), then runs the cross-checks and `schemaDrift`, sorted by file and line;
    `loadContract(root)` returns the loaded `Contract`. Each rule is a function of the
    `Contract`: `versionProblems`, `vocabularyProblems` (every word of `screens.json` is in
    the vocabulary, every code is used), `screensProblems` (anchors unique and never named
    like a derived one, entry and names), `bindingsProblems` (model fields, actions and
    their params, routes, sources, flow events), `routesProblems` with
    `parseRoutePath(path)` (the router's path syntax), `searchProblems` (enum controls,
    `retain`) and `scenariosProblems` (bracket references, roles, ids).
  - The sources check: `collectFromSource(text, file)` reads one file with oxc-parser and
    returns its `Collected` anchors (`data-testid`, `testId` and `*TestId` attributes,
    `testId:` keys, `<NAME>_TEST_ID` constants), the suffixes of its `testIdFor()` calls,
    its codes (`data-code`, and the kebab-case values of `code:` keys and `<NAME>_CODES`
    maps; a domain code such as `note:TEXT_REQUIRED` is left out, a `data-code` outside the
    grammar is a problem) and an anchor built at runtime as a problem (`RUNTIME_ANCHOR`,
    `RUNTIME_SUFFIX`); `scanSources(root)` collects
    the tracked and untracked sources under `SOURCE_ROOTS` (`apps/web/src`,
    `packages/ui/src`) except tests, declarations, generated files, fixtures and snapshots;
    `compareWithContract(collected, screens, vocabulary)` wants each literal declared once,
    the literals equal to the anchors of `screens.json`, no literal named like another plus
    a suffix, and every suffix and code in the vocabulary.
  - `sortProblems(problems)`: by file and line, stable.
  - The manifest: `buildManifest({ vocabulary, screens, model, product, now? })` returns the
    `Manifest` (typed from `manifestSchema`): the vocabulary as tables in `contract` with the
    prose `instructions` for an agent (`instructionsOf`, the anchors and states taken from the
    vocabulary and the platform section), the screens, the platform section and the scenarios
    verbatim, `ids` (every declared anchor with its kind, its screen and its attributes),
    `routeParams` and the model document. `productInfo(root)` names the product (the root
    package's version, the commit checked out or null). `writeManifest(root, outDir, manifest)`
    validates it against `contract/manifest.schema.json` with Ajv and returns the problems
    without writing anything, or empties `outDir` (its last segment must be `ui-manifest`,
    `MANIFEST_DIR`) and writes `manifest.json`, `manifest.schema.json` and `model.schema.json`.
    `emitManifest(root, outDir)` loads the contract and does all three.
  - The anchor helpers of `./anchors`, re-exported.
- `./anchors`: the browser-safe helpers. `ANCHOR_PATTERN`, `isAnchor(text)`,
  `segmentsOf(anchor)`, `kindOf(anchor)` (the last dash-separated word of the last segment),
  `screenOf(anchor, screenNames)` (the longest screen name on segment boundaries);
  `testIdFor(base, suffix)`, the only way to build a derived anchor `<base>.<suffix>`,
  `baseOf(anchor, suffixes)`, `isKnownAnchor(anchor, declared, suffixes)`; `CONTRACT_VERSION`.
  The page helper's contract: `PAGE_HELPER` (`__perch.ui`), `ANCHOR_ATTRIBUTES` (the
  `data-testid`, `data-state`, `data-code`, `data-id` and `data-value` names), the types
  `RenderedAnchor`, `RenderedPage` and `PerchPageHelper`, and `window.__perch` declared on
  `Window` for any code that imports them.

## Commands

- `bun run test`: the anchor grammar, the loaders, the schema writer, the references, the
  contract check and the sources check.
- `bun run typecheck`, `bun run lint`.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources; `bun run contract:schemas -- --check` fails on drift).
- From the root: `bun run contract:check` (the contract files against each other and the
  schema drift; prints `file:line: message` per problem and exits 1, or a one-line
  summary; part of `bun run check` and the pre-commit hook).
- From the root: `bun run contract:check:sources` (`ui-contract check --sources`: the
  contract check, then the anchors and codes of `apps/web/src` and `packages/ui/src`
  against the contract; prints `file:line: message` per problem and exits 1, or
  `contract: sources agree with the contract (<n> anchors)`; not part of `bun run check`
  yet).
- From the root: `bun run contract:manifest` (`ui-contract manifest [--out <dir>]`: builds the
  manifest from the three files and writes it into `ui-manifest/` at the root, gitignored, or
  into `<dir>` relative to the working directory, which may be any folder under the root;
  prints the problems and exits 1 when the manifest does not match its schema). The web app's
  build runs it into `apps/web/dist/ui-manifest/`.
