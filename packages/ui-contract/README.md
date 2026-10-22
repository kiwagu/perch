# UI contract (`@workspace/ui-contract`)

## Role in the architecture

The contract between the user interface and everything that drives it: tests, agents and
the people and models who design screens. The contract is authored first, in the
`contract/` folder at the root (the vocabulary, one YAML file per screen named by its
pathname, the platform file and the model) and in the scenario files of
`tests/e2e/scenarios/`; the model is the source of completeness and each screen unfolds it.
This package loads those files and checks them against each other, holds the web app's and
the kit's JSX (`--sources`) and the e2e tests (`--consumers`) to them, builds the manifest,
measures coverage (the model first, then the controls) and prints the hand-over diff. It
also holds the anchor grammar every `data-testid` follows: 2 to 4 dot-separated kebab-case
segments for a declared anchor and one more for a derived part, the screen name first and the
kind last, as in `user.sign-in.email-input`. The `./anchors` subpath is pure and
browser-safe, so views and the UI kit may import it; the root export is build-time tooling
for Bun.

## Key exports

- `.`: the tooling, for Bun.
  - Loaders of the contract files and of the scenarios, each returning problems
    (`file:line: message` through `formatProblem`): `parseVocabulary(markdown)` (the closed
    lists of `contract/vocabulary.md`, one `## ` section each, `VOCABULARY_SECTIONS`),
    `loadScreens(root)` (every `.yaml` file under `contract/screens`, sorted by path, one screen
    each through `screenFileSchema`, named by the path of its first binding: `/me` is
    `me.yaml`, `/org/$org` is `org/$org.yaml`, the frame without a binding is `__root.yaml`;
    and `contract/platform.yaml`, the version and the platform section, through
    `platformFileSchema`; assembled into one `ScreensFile` whose `files` name the file of each
    screen, problems named by the file and the path inside it, a YAML error by its line),
    `loadModel(root)` (`contract/model.schema.json`, checked against the
    JSON Schema 2020-12 meta-schema, then each `$defs` entity through
    `entityDefinitionSchema`) and `loadScenarios(root)` (every `.md` file under
    `tests/e2e/scenarios`, sorted by path, its id the path without `.md`, through
    `parseScenario`; a path outside the id grammar or a layer outside `SCENARIO_LAYERS` is a
    problem of its file). The paths: `CONTRACT_DIR`, `VOCABULARY_FILE`, `SCREENS_DIR`,
    `PLATFORM_FILE`, `MODEL_FILE`, `SCENARIOS_DIR`, `scenarioFile(id)` and the four schema
    files.
  - The scenario files: `parseScenario(id, markdown)` reads one (a YAML front matter checked
    by `scenarioHeaderSchema`, then the fixed Markdown sections in any order) into a
    `Scenario`, or returns its problems with their lines (`ScenarioProblem`);
    `formatScenario(scenario)` writes one, its inverse.
  - The Zod sources of the files: `screenFileSchema`, `platformFileSchema` and their parts,
    `flowSchema` (a screen's `flow`: the XState v5 machine config subset `createMachine`
    takes as written, its `effectSchema` and `transitionSchema`, with the types `Flow`,
    `FlowState`, `FlowTransition` and `Effect`),
    `flatJsonSchema` (route `params` and `search`, with the bounds `z.toJSONSchema` writes:
    `minimum`, `maximum`, `minLength`, `maxLength`, `pattern`), `scenarioSchema` (the parsed
    scenario), `entityDefinitionSchema`, `manifestSchema`.
    `SCHEMA_OUTPUTS`, `writeSchemas(root)` and `schemaDrift(root)` turn them into the
    committed `contract/screen.schema.json`, `platform.schema.json`, `x-perch.schema.json` and
    `manifest.schema.json` (generated; Biome leaves them as written; `model.schema.json` is
    authored).
  - Ajv for JSON Schema 2020-12: `createValidator()`, `jsonSchemaProblems(file, schema)`,
    `validateAgainst(file, schema, data)`.
  - `referencesIn(text)`: the bracket references of a scenario's text (`[anchor]`,
    `[/route]`, `[code:x]`, `[state:x]`, `[value:x]`).
  - The contract check: `checkContract(root)` loads the contract files and the scenarios
    (stopping at their own problems), then runs the cross-checks and `schemaDrift`, sorted by
    file and line;
    `loadContract(root)` returns the loaded `Contract`. Each rule is a function of the
    `Contract`: `versionProblems`, `vocabularyProblems` (every word of the screens is in
    the vocabulary, every code is used), `screensProblems` (anchors unique and never named
    like a derived one, entry and names), `bindingsProblems` (model fields, actions and
    their params, routes, sources), `flowProblems` (a flow names states, events, guards,
    actions with their `input`, anchors with their codes and bindings that exist, reaches
    every state, leaves every state that is not final, and puts the one transition without
    a guard last), `routesProblems` with
    `parseRoutePath(path)` (the router's path syntax), `searchProblems` (enum controls,
    `retain`) and `scenariosProblems` (bracket references and roles, as problems of each
    scenario's file).
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
    the literals equal to the anchors of the screen files, no literal named like another plus
    a suffix, and every suffix and code in the vocabulary.
    `ignoreMarkers(text, { program, comments })` reads the coverage-ignore markers of a parsed
    file: `ui-contract-ignore: <reason>` (the element and its subtree) or
    `ui-contract-ignore-self: <reason>` (the element alone), as a line comment in code or as
    the only content of a JSX comment container among JSX children, with only white space
    before the element; each `IgnoreMarker` points at the element after it, and a marker
    whose own reason is shorter than three characters, or in another form, is a fault
    (`IGNORE_WITHOUT_REASON`, `IGNORE_MALFORMED`; `IGNORE_WITHOUT_ELEMENT` when no element
    starts where it points).
  - The consumers check: `collectFromTest(text, file)` reads one file of the e2e tests with
    oxc-parser and returns what it names of the contract (`Consumed`, its
    `ConsumedLiteral`s): the anchor of a `getByTestId('<anchor>')` call; in any string or
    template literal the `[data-testid="..."]`, `[data-code="..."]`, `[data-state="..."]`
    and `[data-value="..."]` selectors, in double or single quotes; and the value a
    `toHaveAttribute('data-<testid|code|state|value>', '<value>')` assertion expects, `.not`
    included; each argument a plain string or a template literal without `${}`, or a `+`
    chain of them read as the one string it folds to (a TypeScript wrapper such as
    `as const` changes nothing), each selector at its line in the source, whatever escapes
    its literal holds, a `+` chain read whole as a template is. A `data-id` is data and is
    not read, and neither is a helper call such as `notice(page, '<code>')`; an anchor built
    at runtime (a `data-testid` selector whose value or closing quote an expression
    supplies, a `getByTestId` of anything else) is a problem (`RUNTIME_TEST_ANCHOR`), a
    code, a state or a value from an expression passes. `scanConsumers(root, tests?)`
    collects the `.ts` files under `CONSUMER_ROOT` (`tests/e2e/src`) or the folder given;
    `compareConsumers(consumed, contract)` wants every anchor known (declared, or derived
    from a declared base with a suffix it lists in `derived`), every code, state and choice
    value in the vocabulary, as the scenarios check resolves its bracket references.
  - `sortProblems(problems)`: by file and line, stable.
  - The manifest: `buildManifest({ vocabulary, screens, model, scenarios, product, now? })`
    returns the `Manifest` (typed from `manifestSchema`): the vocabulary as tables in
    `contract` with the prose `instructions` for an agent (`instructionsOf`, the anchors and
    states taken from the vocabulary and the platform section), the screens and the platform
    section verbatim, the scenarios parsed, `ids` (every declared anchor with its kind, its
    screen and its attributes), `routeParams` and the model document. `productInfo(root)`
    names the product (the root package's version, the commit checked out or null).
    `writeManifest(root, outDir, manifest)` validates it against
    `contract/manifest.schema.json` with Ajv and returns the problems
    without writing anything, or empties `outDir` (its last segment must be `ui-manifest`,
    `MANIFEST_DIR`) and writes `manifest.json` (two spaces deep, each entry of `ids` on one
    line, so a search for an anchor shows its facts), `manifest.schema.json` and
    `model.schema.json`.
    `emitManifest(root, outDir)` runs the contract check, writes nothing and returns its
    problems when it finds any, or loads the contract and does all three.
  - The hand-over: `contractAt(ref, root)` reads the contract files, the screen files and the
    scenarios at a git ref (`git ls-tree`, `git show`) and loads them, or returns
    `{ missing: true }` when that commit has no `contract/`;
    `diffContracts(before, after)` returns the `ContractChanges` (screens, anchors, codes,
    entities and fields as `entity.field`, added and removed, sorted; an anchor removed and
    one added are a rename when they are the only ones of their screen and kind);
    `formatChanges(changes)` prints the block a change hands over: a summary line, then one
    line per list that is not empty.
  - The coverage note: `modelCoverage(contract)` lists, per entity of the model, every field
    and action with the anchors whose binding (one or a list) names it, none when it is
    unbound (`ModelCoverage`, `BoundMember`): the first measure. `countControls(text, file)`
    counts the controls of one source file (`CONTROL_TAGS`, or any element with an
    `onClick`) and how many carry an anchor, lists the unmarked ones by line, tag and static
    label (`ControlPlace`), the ones a coverage-ignore marker declares off with its reason
    (whatever they carry), and the markers it cannot apply as problems; `measureCoverage(root)` returns the model's
    measure, the controls per feature module (`FEATURES_DIR`) and for the kit (`UI_KIT_DIR`,
    `UI_KIT_MODULE`) with the unmarked and ignored ones by file (`FileControl`), and per
    screen its anchors and the scenarios that reach it; `renderCoverage(measure, totals)`
    (`totalsOf`) prints the block, its totals line `fields bound x/y, actions bound x/y`
    before the controls marked and ignored, `listControls(measure)` the two lists as
    `file:line: <element>`, and `replaceCoverageBlock(note, block)` puts the block between
    `COVERAGE_START` and `COVERAGE_END` of `COVERAGE_FILE`. The counting method is described
    in `contract/COVERAGE.md`; it is a report, not a rule of the contract.
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

- `bun run test`: the anchor grammar, the loaders, the scenario parser and formatter, the
  schema writer, the references, the contract check, the sources check, the consumers check,
  the coverage-ignore markers, the manifest, the hand-over diff and the coverage note.
- `bun run typecheck`, `bun run lint`.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources; `bun run contract:schemas -- --check` fails on drift).
- From the root: `bun run contract:check` (the contract files and the scenarios against each
  other and the schema drift; prints `file:line: message` per problem and exits 1, or a
  one-line summary; part of `bun run check` and the pre-commit hook).
- From the root: `bun run contract:check:sources` (`ui-contract check --sources`: the
  contract check, then the anchors and codes of `apps/web/src` and `packages/ui/src`
  against the contract; prints `file:line: message` per problem and exits 1, or
  `contract: sources agree with the contract (<n> anchors)`; part of `bun run check` and
  the pre-commit hook).
- From the root: `bun run contract:check:consumers` (`ui-contract check --consumers
  [--tests=<dir>]`: the contract check, then the anchors, codes, states and values the e2e
  tests under `tests/e2e/src`, or `<dir>` relative to the root, name as literals against the
  contract; prints `file:line: message` per problem and exits 1, or
  `contract: the e2e tests agree with the contract (<n> anchors)`; part of `bun run check`
  and the pre-commit hook).
- From the root: `bun run contract:manifest` (`ui-contract manifest [--out <dir>]`: builds the
  manifest from the contract files and the scenarios and writes it into `ui-manifest/` at the
  root, gitignored, or into `<dir>` relative to the working directory, which may be any
  folder under the root; prints the problems and exits 1 when the contract check finds any
  or the manifest does not match its schema). The web app's build runs it into
  `apps/web/dist/ui-manifest/`.
- From the root: `bun run contract:diff <ref>` (`ui-contract diff <ref> [--json]`: what the
  contract of the working tree adds, removes and renames against the contract at the git ref
  `<ref>`, all of it as added when that commit has no `contract/`; prints the hand-over block,
  or the changes as JSON with `--json`). A change to the contract carries the output of
  `bun run contract:diff main` in its description.
- From the root: `bun run contract:coverage` (`ui-contract coverage [--write] [--json]
  [--unmarked]`: the coverage block, first the fields and actions of each entity of the
  model with the anchors bound to them, then the controls marked and ignored per feature
  module and for the kit with the unmarked and ignored ones listed, and the anchors and
  scenarios per screen; `--write` puts it between the markers of `contract/COVERAGE.md`,
  `--json` prints the measure, `--unmarked` prints the unmarked controls and the ignored ones
  with their reasons as `file:line: <element>`; a coverage-ignore marker without a reason or
  without an element after it is printed as a problem and exits 1, writing nothing). Not
  part of `bun run check`: the note is a report.
