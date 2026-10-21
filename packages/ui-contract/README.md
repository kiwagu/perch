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
    `params` and `search`, with the bounds `z.toJSONSchema` writes: `minimum`, `maximum`,
    `minLength`, `maxLength`, `pattern`), `scenarioSchema`, `entityDefinitionSchema`, `manifestSchema`.
    `SCHEMA_OUTPUTS`, `writeSchemas(root)` and `schemaDrift(root)` turn them into the
    committed `contract/screens.schema.json`, `x-perch.schema.json` and
    `manifest.schema.json` (generated; Biome leaves them as written; `model.schema.json` is
    authored).
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
    `emitManifest(root, outDir)` runs the contract check, writes nothing and returns its
    problems when it finds any, or loads the contract and does all three.
  - The hand-over: `contractAt(ref, root)` reads the three files at a git ref (`git show`) and
    loads them, or returns `{ missing: true }` when that commit has no `contract/`;
    `diffContracts(before, after)` returns the `ContractChanges` (screens, anchors, codes,
    entities and fields as `entity.field`, added and removed, sorted; an anchor removed and
    one added are a rename when they are the only ones of their screen and kind);
    `formatChanges(changes)` prints the block a change hands over: a summary line, then one
    line per list that is not empty.
  - The coverage note: `countControls(text, file)` counts the controls of one source file
    (`CONTROL_TAGS`, or any element with an `onClick`) and how many carry an anchor, and lists
    the others by line and tag; `measureCoverage(root)` counts them per feature module
    (`FEATURES_DIR`) and for the kit (`UI_KIT_DIR`, `UI_KIT_MODULE`), and per screen its
    anchors and the scenarios that reach it; `renderCoverage(measure, totals)` (`totalsOf`)
    prints the block and `replaceCoverageBlock(note, block)` puts it between
    `COVERAGE_START` and `COVERAGE_END` of `COVERAGE_FILE`. The counting method is described
    in `contract/COVERAGE.md`; it is an indicator, not a rule of the contract.
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
  contract check, the sources check, the manifest, the hand-over diff and the coverage note.
- `bun run typecheck`, `bun run lint`.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources; `bun run contract:schemas -- --check` fails on drift).
- From the root: `bun run contract:check` (the contract files against each other and the
  schema drift; prints `file:line: message` per problem and exits 1, or a one-line
  summary; part of `bun run check` and the pre-commit hook).
- From the root: `bun run contract:check:sources` (`ui-contract check --sources`: the
  contract check, then the anchors and codes of `apps/web/src` and `packages/ui/src`
  against the contract; prints `file:line: message` per problem and exits 1, or
  `contract: sources agree with the contract (<n> anchors)`; part of `bun run check` and
  the pre-commit hook).
- From the root: `bun run contract:manifest` (`ui-contract manifest [--out <dir>]`: builds the
  manifest from the three files and writes it into `ui-manifest/` at the root, gitignored, or
  into `<dir>` relative to the working directory, which may be any folder under the root;
  prints the problems and exits 1 when the contract check finds any or the manifest does not
  match its schema). The web app's build runs it into `apps/web/dist/ui-manifest/`.
- From the root: `bun run contract:diff <ref>` (`ui-contract diff <ref> [--json]`: what the
  contract of the working tree adds, removes and renames against the contract at the git ref
  `<ref>`, all of it as added when that commit has no `contract/`; prints the hand-over block,
  or the changes as JSON with `--json`). A change to the contract carries the output of
  `bun run contract:diff main` in its description.
- From the root: `bun run contract:coverage` (`ui-contract coverage [--write] [--json]`: the
  coverage block, the controls marked per feature module and for the kit, the anchors and
  scenarios per screen; `--write` puts it between the markers of `contract/COVERAGE.md`,
  `--json` prints the measure). Not part of `bun run check`: the note is an indicator.
