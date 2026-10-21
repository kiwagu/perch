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
  - The anchor helpers of `./anchors`, re-exported.
- `./anchors`: the browser-safe helpers. `ANCHOR_PATTERN`, `isAnchor(text)`,
  `segmentsOf(anchor)`, `kindOf(anchor)` (the last dash-separated word of the last segment),
  `screenOf(anchor, screenNames)` (the longest screen name on segment boundaries);
  `testIdFor(base, suffix)`, the only way to build a derived anchor `<base>.<suffix>`,
  `baseOf(anchor, suffixes)`, `isKnownAnchor(anchor, declared, suffixes)`; `CONTRACT_VERSION`.

## Commands

- `bun run test`: the anchor grammar, the loaders, the schema writer and the references.
- `bun run typecheck`, `bun run lint`.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources; `bun run contract:schemas -- --check` fails on drift).
