# UI contract (`@workspace/ui-contract`)

## Role in the architecture

The contract between the user interface and everything that drives it: tests, agents and
the people and models who design screens. The contract is authored first, in the
`contract/` folder at the root (the vocabulary, one YAML file per screen named by its
pathname, the platform file, the model and the activities across screens) and in the
scenario files of `tests/e2e/scenarios/`; the model is the source of completeness and each
screen unfolds it.
This package loads those files and checks them against each other, holds the web app's and
the kit's JSX (`--sources`) and the e2e tests (`--consumers`) to them, builds the manifest,
measures coverage (the model first, then the controls) and prints the hand-over diff. It
also holds the anchor grammar every `data-testid` follows: 2 to 4 dot-separated kebab-case
segments for a declared anchor and one more for a derived part, the screen name first and the
kind last, as in `user.sign-in.email-input`. The `./anchors` subpath is pure and
browser-safe, so views and the UI kit may import it; the root export is build-time tooling
for Bun.

## Key exports

The rules these exports implement are written once, in `contract/REFERENCE.md`, which each line
links to as `contract/REFERENCE.md#<slug>`.

- `.`: the tooling, for Bun.
  - Loaders of the contract files and of the scenarios, each returning problems
    (`file:line: message` through `formatProblem`):
    - `parseVocabulary(markdown)`: the closed lists of `contract/vocabulary.md`, one `## `
      section each (`VOCABULARY_SECTIONS`); a vocabulary without its "Composites" section reads
      as an empty table, and one without its "Roles" section too (a terms file holds them;
      `writesRoles` says whether the section is there).
    - `loadTerms(root)`: `contract/domain/terms.yaml` (`TERMS_FILE`) through `termsFileSchema`,
      none when the contract leaves it out; `loadContract` then takes the contract's roles from
      it (`contract/REFERENCE.md#rule-terms`).
    - `loadScreens(root)` and `loadScreensWith(root, model)` (with a model already loaded, as
      the contract check does, which takes back the model with its lengths resolved): every
      `.yaml` file under `contract/domain/screens`, sorted by path, the platform's values, the
      inline parameters of its actions and the model first taking their default length
      (`files/values/default-lengths.ts`), with what it
      leaves out derived from the model and the platform (`files/derive/`:
      `composites.ts`, `form-params.ts`, `paging.ts`, `errors.ts`, `flow-errors.ts`, `inputs.ts`,
      `leaves.ts`, `toasts.ts`, `confirmations.ts`, `questions.ts`, `requests.ts`) and its flow
      expanded from the shorter forms (`files/expand-flow/`: `effects.ts`, `requests.ts`,
      `area-error.ts`, `toasts/`), then parsed through `screenFileSchema`
      (`contract/REFERENCE.md#rule-what-stays`,
      `contract/REFERENCE.md#rule-composite-of-the-platform`,
      `contract/REFERENCE.md#rule-button-params`,
      `contract/REFERENCE.md#rule-error-codes-and-fields`,
      `contract/REFERENCE.md#rule-failure-show`, `contract/REFERENCE.md#rule-request-outcome`,
      `contract/REFERENCE.md#rule-area-request`,
      `contract/REFERENCE.md#rule-success-toast`,
      `contract/REFERENCE.md#rule-destructive-question`,
      `contract/REFERENCE.md#rule-field-holds-input`,
      `contract/REFERENCE.md#rule-leave-questions`).
    - The platform file, `contract/domain/platform.yaml`, through `platformFileSchema`, and the
      screens assembled into one `ScreensFile` whose `files` name the file of each screen and
      whose `toasts` record the toasts the loader derived; a screen file is named by the path of
      its first binding (`contract/REFERENCE.md#rule-route-bindings`), and the platform file's
      keys are the `platform-*` keys of the reference.
    - `loadModel(root)`: `contract/domain/model.schema.json`, checked against the JSON Schema
      2020-12 meta-schema, then each `$defs` entity through `entityDefinitionSchema`, each action
      a `ModelAction` (its `params` and its `changes`), as the file writes it;
      `loadResolvedModel(root)`: that model as every reader takes it, each field with its
      default length, for a reader of the model alone.
    - `loadActivities(root)`: every `.yaml` file under `contract/domain/activities`, one activity
      each through `activitySchema`, its file named by its id; the folder is optional.
    - `loadScenarios(root)`: every `.md` file under `tests/e2e/scenarios`, its id the path
      without `.md`, through `parseScenario` (`SCENARIO_LAYERS`;
      `contract/REFERENCE.md#rule-scenario-files`). `loadActivities` and `loadScenarios` return
      beside their files `lines`, the line of each place by its JSON path, which the `Contract`
      carries as `activityLines` and `scenarioLines`.
    - The paths: `CONTRACT_DIR`, `DOMAIN_DIR`, `VOCABULARY_FILE`, `SCREENS_DIR`, `screenFile(path)`,
      `PLATFORM_FILE`, `MODEL_FILE`, `ACTIVITIES_DIR`, `activityFile(id)`, `SCENARIOS_DIR`,
      `scenarioFile(id)`, `REFERENCE_FILE`, `COVERAGE_FILE`, the five schema files and
      `GUIDE_FILES` (the prose that links into the reference); `isBusinessFile(path)` says
      whether a file is one of the business layer's (`contract/REFERENCE.md#rule-layers-and-commits`).
  - The values (`files/values/`): `resolveValue(ref, platform, model)` gives the `ResolvedValue`
    a name of `platform.values` or a field of the model names, `parameterValueOf(action, param,
    platform, model)` the one a parameter takes, and `fieldValueOf(anchor, screen, platform,
    model)` the one a field takes, the loosest of those of its bindings;
    `withDefaultLength(value, defaults, readOnly?)` gives a value the platform's default length
    where it names none, and `withDefaultLengths(platform, model)` does it once for the platform's
    values and inline action parameters and the model as they load (`contract/REFERENCE.md#rule-declared-values`).
  - `attributedCodes(action, platform)` (`files/derive/failures.ts`): per parameter of a platform
    action, the codes that concern it, by the suffixes of `FIELD_CODE_SUFFIXES`
    (`contract/REFERENCE.md#rule-attributed-codes`).
  - `codeNamesOf(codes)`, `codeEntriesOf(codes)` and `outcomesOf(result)`
    (`files/action-codes.ts`): a platform action's codes by name, each with its place and its
    invariants and condition, and its outcome lines, read one way whether it writes the codes as a
    map or as the older list a contract before version 6 may write, its result as a list or as one
    string; `invariantActions(platform)`
    (`files/invariants.ts`): per invariant of `platform.invariants`, the actions that name it, in
    the platform file's order (`contract/REFERENCE.md#rule-action-outcomes`).
  - `readDescriptions(root)` (`files/written-descriptions/`): every description the domain files
    write, as they write them, each a `WrittenDescription` (`file`, `line`, `at`, `kind`, `place`,
    `text`); the `Contract` carries them as `descriptions`, read by `loadContract`
    (`contract/REFERENCE.md#rule-description-places`).
  - The scenario files: `parseScenario(id, markdown)` reads one (`scenarioHeaderSchema`) into a
    `Scenario` with `lines`, or returns its problems (`ScenarioProblem`); `formatScenario(scenario)`
    writes one, its inverse (`contract/REFERENCE.md#rule-scenario-format`).
  - The Zod sources of the files: `screenFileSchema`, `authoredScreenFileSchema`,
    `authoredFlowSchema`, `draftPatternSchema`, `controlRegionSchema`, `authoredAnchorDefSchema`
    (the source of `contract/schemas/screen.schema.json`), `platformFileSchema`,
    `platformMailSchema` (`PlatformMail`), `platformNoticeSchema` (`PlatformNotice`), `ACCOUNT`,
    `RECIPIENT`, `flowSchema` with `codeGuardSchema`, `effectSchema`, `branchReadOptOutSchema` and
    `transitionSchema` and the types `Flow`, `FlowState`, `FlowParallelState`, `FlowRegion`,
    `FlowRegionState`, `FlowTransition` and `Effect`, `activitySchema` (`Activity`, `ActivityState`,
    `ActivityTransition`), `flatJsonSchema`, `scenarioSchema`, `entityDefinitionSchema` and
    `manifestSchema`; each key's text is its `.describe()` (`contract/REFERENCE.md#screen-flow`,
    `contract/REFERENCE.md#rule-flow-states`, `contract/REFERENCE.md#rule-flow-effects`,
    `contract/REFERENCE.md#rule-renders`, `contract/REFERENCE.md#rule-check-platform`,
    `contract/REFERENCE.md#screen-anchors-name-source-paged`,
    `contract/REFERENCE.md#platform-actions-name-changes`). `SCHEMA_OUTPUTS`, `writeSchemas(root)`
    and `schemaDrift(root)` turn them into the committed files of `contract/schemas/` (generated;
    `model.schema.json` is authored), and `writeSchemas` writes the reference after them.
    `DESCRIPTION_PURPOSES` gives, by its `DescriptionKind`, the purpose of each description field
    in one text, `DESCRIPTION_BUDGET` its budget, and `descriptionLength(text)` counts a
    description as the budget does (`contract/REFERENCE.md#rule-check-files`);
    `BEHAVIOUR_PURPOSES`, by its `BehaviourKind`, the purpose of an outcome line, a condition and
    a rule, which keep the same budget (`contract/REFERENCE.md#rule-action-outcomes`).
  - The reference: `renderReference()` is the text of `contract/REFERENCE.md` (`REFERENCE_FILE`,
    generated, never edited): one section per file with each key the schema describes, then
    `REFERENCE_RULES`, the engine's rules that no key states (`ReferenceRule`: a kebab-case `id`,
    a `title`, its `text` and the `keys` it concerns). Each entry carries an explicit anchor,
    `referenceSlug(...parts)` of its file and path (`screen-anchors-name-secret`) or `rule-<id>`,
    which a guide links to as `contract/REFERENCE.md#<slug>`. `referenceDrift(root)`: the
    committed reference missing, or other than what the engine renders.
    `referenceLinkProblems(root)` (`reference/links.ts`): each such link in a guide of
    `GUIDE_FILES` that names no anchor of the reference.
  - Ajv for JSON Schema 2020-12: `createValidator()`, `jsonSchemaProblems(file, schema)`,
    `validateAgainst(file, schema, data)`.
  - `referencesIn(text)`: the bracket references of a scenario's text, in the order the text
    writes them (`contract/REFERENCE.md#rule-scenario-brackets`).
  - The contract check: `checkContract(root)` loads the contract files, the activities and the
    scenarios (stopping at their own problems), then runs the cross-checks, `schemaDrift`,
    `referenceDrift` and `referenceLinkProblems`, sorted by file and line; `loadContract(root)`
    returns the loaded `Contract` (`contract/REFERENCE.md#rule-checks`). Each rule is a function
    of the `Contract`:
    - `versionProblems`: the version `platform.yaml` declares is one this engine reads, at most
      `CONTRACT_VERSION` (`contract/REFERENCE.md#rule-editions-and-migrations`);
    - `vocabularyProblems`, `screensProblems`, `descriptionsProblems`: the vocabulary's words,
      the anchors' uniqueness and their facets, the descriptions' budget
      (`contract/REFERENCE.md#rule-check-files`);
    - `invariantsProblems`, `behaviourTextsProblems`, `actionFormsProblems`: each invariant an
      action names exists and refuses with the code it is named under, every invariant is named,
      each outcome line, condition and rule keeps the budget, and from version 6
      (`BEHAVIOUR_EDITION`) a `result` of one string keeps it too and an action's codes are a map,
      never a list (`contract/REFERENCE.md#rule-action-outcomes`);
    - `bindingsProblems`, `searchProblems`, `routesProblems` with `parseRoutePath(path)` (the
      router's path syntax): model fields, actions and their params, routes and the search
      parameters (`contract/REFERENCE.md#rule-check-bindings`);
    - `keyProblems`: the key of an address, a search parameter that writes `x-perch.key`: its code
      one of an action the screen runs with it, whose parameter refers to a value, one key per
      route, no `default` (`contract/REFERENCE.md#rule-address-key`);
    - `withProblems`: when an element shows beside others, its `with` and `without`: anchors of
      its own screen, a code entry's codes among the anchor's, never itself, twice or in a cycle,
      and under an entry of a list anchors of the same entry (`entryOf` of `./anchors`)
      (`contract/REFERENCE.md#rule-with-without`);
    - `flowProblems` over the tree of a flow's states, with `flowNodes(flow)` (every state as a
      `FlowNode`: a `RootNode`, `ParallelNode`, `RegionNode` or `RegionStateNode`), `deepTargetOf`,
      `idTargetOf`, `rootOf`, `regionStartsOf` and `deepEnteredOf` (the parts of a `DeepTarget` and
      an `IdTarget`); the reads are in `flow/reads.ts`, `flow/held-reads.ts`, `flow/items.ts`,
      `flow/pages.ts` and `flow/leaves.ts` (`contract/REFERENCE.md#rule-check-flows`,
      `contract/REFERENCE.md#rule-read-after-an-action`, `contract/REFERENCE.md#rule-renders`,
      `contract/REFERENCE.md#rule-flow-events`, `contract/REFERENCE.md#rule-request-outcome`);
    - `activitiesProblems`, `runsProblems`: an activity agrees with the screens it visits, and
      every flow and activity runs in XState as written, by the walk of `./machines`
      (`contract/REFERENCE.md#rule-flow-run`, `contract/REFERENCE.md#rule-activities`);
    - `leavingProblems`, `toastsProblems`, `unsavedInputProblems`, `mailsProblems`,
      `noticesProblems`: the platform file's leaving actions, toasts, unsaved-input questions,
      mails and notices (`contract/REFERENCE.md#rule-check-platform`);
    - `changesProblems`: the reads an action changes
      (`contract/REFERENCE.md#rule-read-after-an-action`);
    - `accessProblems`, `pagingProblems`: who a route serves, and a paged list
      (`contract/REFERENCE.md#rule-check-access`, `contract/REFERENCE.md#rule-paged-list`);
    - `scenariosProblems`: bracket references, resolved by `unknownNotice`, and the activity a
      scenario names, as problems of each scenario's file
      (`contract/REFERENCE.md#rule-scenario-brackets`).
  - Editions (`check/editions.ts`): `editionOf(contract)`, `since(contract, N)` and
    `outdatedProblem(contract)`: a contract is read by the version its `platform.yaml` declares
    (`contract/REFERENCE.md#rule-editions-and-migrations`).
  - Migrations (`files/migrations/`, written up in `MIGRATIONS.md`): `migrate(root, { write,
    migrations?, current? })` runs each `Migration` (`from`, `note`, `run(files)` over the
    `MigrationFiles`: the platform and the screens as YAML documents, the vocabulary and the
    model as text) of the registry `MIGRATIONS` from the declared version up to `current`,
    `CONTRACT_VERSION` by default, and returns the `MigrationReport`; with `write` it writes the
    files the steps changed (`files/write-yaml-document/`: only the nodes a step edited change).
    `parseYamlDocument(text)`: the `yaml` package's `Document` of a text, its comments and styles
    kept.
  - `anchorCarries(contract)` (`Carried`) says whether an anchor carries a code, a state or a
    value, and `pairingResolver(contract)` why a value does not pair with its anchor, for the
    scenarios and the consumers check alike (`contract/REFERENCE.md#rule-scenario-brackets`).
  - The sources check: `collectFromSource(text, file)` reads one file with oxc-parser and returns
    its `Collected` anchors, `testIdFor()` suffixes, codes, `inputs` (`holdsInput`), `colours`
    (`marksState`) and `props` (`maxLength`, `type`, `aria-invalid`, `disabled`), following a name
    of the file to what it declares (`sources/locals.ts`, in the scope that binds it,
    `sources/bindings.ts`, `sources/scopes.ts`, every object a value may be in
    `sources/alternatives.ts`: an anchor a `<NAME>_TEST_ID` constant
    holds, the props a spread on an element supplies, `sources/spreads.ts`, read per element in
    `sources/element.ts`, the event a `disabled`
    asks its machine about, `sources/asked-event.ts`, with what the file's type declarations say of
    a spread it cannot follow, `sources/declared-type.ts`, whether a function body can run off its
    end, `sources/reachable-end.ts`); `scanSources(root)` collects the sources under `SOURCE_ROOTS`,
    refusing in any typed file of the repository a `declare module` that names one, a backslash
    read as a separator (`sources/augmentation.ts`; only a fixture project outside the web app
    and the UI kit with a `tsconfig.json` of its own inside its `__fixtures__` folder is left out);
    `compareWithContract(collected, screens, vocabulary)` holds them to the contract, with
    `codesOf(vocabulary, screens)` (the kit takes a field's `holdsInput`, `marksState`, `maxLength`
    and `type` from the emitted field facts, so a view writes none: `sources/opt-outs.ts` and
    `sources/facets.ts` refuse it, the size select's `holdsInput` included); the
    problem codes are `RUNTIME_ANCHOR`, `RUNTIME_SUFFIX`, `HOLDS_INPUT_VALUE`,
    `HOLDS_INPUT_ANCHOR`, `MARKS_STATE_VALUE` and `MARKS_STATE_ANCHOR`
    (`contract/REFERENCE.md#rule-check-sources`, `contract/REFERENCE.md#rule-field-holds-input`).
    `ignoreMarkers(text, { program, comments })` reads the coverage-ignore markers of a parsed
    file (`IgnoreMarker`; the faults `IGNORE_WITHOUT_REASON`, `IGNORE_MALFORMED`,
    `IGNORE_WITHOUT_ELEMENT`, `IGNORE_NO_CONTROL`).
  - The consumers check: `collectFromTest(text, file)` reads one file of the e2e tests with
    oxc-parser and returns what it names of the contract (`Consumed`, its `ConsumedLiteral`s);
    `scanConsumers(root, tests?)` collects the `.ts` files under `CONSUMER_ROOT`;
    `compareConsumers(consumed, contract)` holds them to the contract, `elementAnchors`
    (`elements.ts`) and `assertedAnchor` (`receiver.ts`) pairing a code, a state or a value with
    its anchor; an anchor built at runtime is `RUNTIME_TEST_ANCHOR`
    (`contract/REFERENCE.md#rule-check-consumers`).
  - `sortProblems(problems)`: by file and line, stable.
  - The manifest: `buildManifest({ vocabulary, screens, model, activities, scenarios, product,
    now? })` returns the `Manifest` (typed from `manifestSchema`), with the prose `instructions`
    for an agent (`instructionsOf`), `fieldStates` (`fieldStatesOf`), `derivedParts`, `composites`,
    each binding's `example` link (`exampleOf`), each anchor's description (the written one, else
    the one the engine says, `files/derive/descriptions.ts`), `ids`, `routeParams`, the
    platform's values and the model document with their lengths resolved, from version 6
    `contract.defaults`, and last `rules`: the text of each rule the manifest or its schema names,
    from the registry of the reference (`rulesOf`, `manifest/rules.ts`, naming found by
    `ruleIdsNamedIn`, the text by `ruleTextOf`), so a reader of the manifest folder alone has it
    (`contract/REFERENCE.md#rule-manifest`, `contract/REFERENCE.md#rule-field-states-carried`,
    `contract/REFERENCE.md#rule-engine-descriptions`). `productInfo(root)` names the product.
    `writeManifest(root, outDir, manifest)` validates it against
    `contract/schemas/manifest.schema.json` and writes it into `outDir`, whose last segment must
    be `ui-manifest` (`MANIFEST_DIR`); `emitManifest(root, outDir)` runs the contract check first.
    `settledProblems(contract, settled)`: the e2e harness's check of a `SettledState` against the
    manifest (any `SettledContract`; `contract/REFERENCE.md#rule-settled-state`), an element's
    `with` and `without` and a list with no entries among them
    (`contract/REFERENCE.md#rule-with-without`, `contract/REFERENCE.md#rule-empty-list`).
  - The emitted modules (`emit/`): `valuesModuleOf(contract)` is the text of a module of plain
    data, `CONTRACT_VALUES`, every value of the platform and every field of the model as the
    contract resolves it, and `fieldFactsModuleOf(contract)` that of `FIELD_FACTS`, what the
    element of each field carries that the contract decides, by its anchor, and
    `termsModuleOf(contract)` that of `CONTRACT_ROLES` and `CONTRACT_ROUTES`, every role by its
    name and every screen's route path by its id (`contract/REFERENCE.md#rule-emitted-modules`); `heldModule({ committed, emit, root, env })`
    is the text a package's committed module must equal (see `./testing` below).
  - The hand-over: `contractAt(ref, root)` reads the contract files at a git ref, or returns
    `{ missing: true }` when that commit has no `contract/`; `diffContracts(before, after)` returns
    the `ContractChanges` (`contract/REFERENCE.md#rule-contract-diff`), among them the lines of a
    flow (`flowLines(flow)`, `handoff/flow-lines.ts`, an internal helper), of a platform action
    (`actionLines(action)`, `handoff/action-lines.ts`, an internal helper) and of each list's
    source (`handoff/source-lines.ts`) (`contract/REFERENCE.md#rule-contract-diff-lines`);
    `descriptionChanges(before, after, renamed)` (`handoff/description-changes.ts`) returns the
    `DescriptionChange`s `{ place, before?, after? }` (`contract/REFERENCE.md#rule-description-places`);
    `formatChanges(changes)` prints the block a change hands over
    (`contract/REFERENCE.md#rule-hand-over`).
  - The coverage note: `modelCoverage(contract)` (`ModelCoverage`, `BoundMember`),
    `activityCoverage(contract)` (`ActivityCoverage`), `countControls(text, file)` (`CONTROL_TAGS`,
    `ControlPlace`), `measureCoverage(root)` (`FEATURES_DIR`, `UI_KIT_DIR`, `UI_KIT_MODULE`,
    `FileControl`, `unusedComposites`), `renderCoverage(measure, totals)` with `totalsOf`,
    `compositeNotes(measure)` (internal to the coverage command), `listControls(measure)`,
    `replaceCoverageBlock(note, block)` between `COVERAGE_START` and `COVERAGE_END` of
    `COVERAGE_FILE`, and `coverageDrift(note, block)` (`handoff/coverage-drift.ts`); the counting
    method is in `contract/COVERAGE.md` (`contract/REFERENCE.md#rule-coverage`).
    `listDescriptions(contract)` (`handoff/descriptions.ts`, internal, behind
    `coverage --descriptions`) lists the written descriptions the engine would say itself.
  - `parameterSample(parameter, slot)`: the value of a route parameter a link carries in a
    `SampleSlot`, `path` or `search`, or none (`contract/REFERENCE.md#rule-route-example`).
  - The routes view: `exampleOf(binding)` returns its `RouteExample`; `routesOf(contract)` the
    `RoutesView` (a `RouteRow` per binding, its `example` and `ReachedFrom`, and the `tree`);
    `routeTree(screens)` the `RouteNode`s, `ROOT_ROUTE` first; `renderRoutes(view)` prints the four
    sections of `ui-contract routes` (`contract/REFERENCE.md#rule-route-example`).
  - The anchor helpers of `./anchors`, re-exported.
- `./anchors`: the browser-safe helpers.
  - The grammar: `ANCHOR_PATTERN`, `isAnchor(text)`, `segmentsOf(anchor)`, `kindOf(anchor)`,
    `screenOf(anchor, screenNames)`, `testIdFor(base, suffix)` (the only way to build a derived
    anchor), `baseOf(anchor, suffixes)`, `sizeOptionOf(list)`, `isSizeOption(anchor, paged)` and
    `isKnownAnchor(anchor, declared, suffixes, paged)` (it checks the suffix against the
    vocabulary's table and the base against the declared anchors, as the engine's `knownAnchors`
    tells them; `contract/REFERENCE.md#rule-anchor-grammar`);
    `CONTRACT_VERSION`, the newest version of the contract format the engine reads.
  - The entries of a list: `isUnder(anchor, other)`, `partOf(anchor)`, `CONTROL_KINDS` (with
    `FIELD_KINDS`), `ENTRY_KINDS`, `containersOf(entry, anchors)`, `inPartOf(entry, control)`,
    `entryOf(anchor, anchors)` (the entry an anchor is rendered in) and `itemIdOf(control, item)`
    (`contract/REFERENCE.md#rule-entries-of-a-list`).
  - When an element shows beside others: `WithEntry`, `entryAnchorOf(entry)`,
    `entryCodesOf(entry)`, and on a page as the helper reads it `entryShowsOn(entry, anchors)` and
    `entriesShowOn(element, anchors)` (`ShowsWith`) (`contract/REFERENCE.md#rule-with-without`).
  - The roles a device holds: `GUEST`, `IDENTITY`, `heldRoles(signedIn, others)` and
    `admits(roles, held)` (`contract/REFERENCE.md#rule-roles`).
  - A paged list: `PAGE`, `SIZE`, `PAGING_PARTS` (`RANGE`, `PREVIOUS_LINK`, `NEXT_LINK`,
    `SIZE_SELECT`), `pagerOf({ page, size, shown, total })` (the `Pager`), `searchKeysOf(source)`
    and `pageSearchOf(search, { page, size }, defaultSize)` (`contract/REFERENCE.md#rule-paged-list`).
  - What a state renders, from a flow or from an app's machine config: `renderedAt(config, value)`
    (the `RenderedAt`), `isListed(at, anchor)`, `isRendered(at, anchor)` and `listedBy(state)`
    (`contract/REFERENCE.md#rule-renders`).
  - The eye of a password input: `VISIBILITY_BUTTON`, `VISIBILITY_BASE_KIND` and
    `VISIBILITY_VALUES` (`contract/REFERENCE.md#rule-visibility-button`).
  - The page helper's contract: `PAGE_HELPER`, `ANCHOR_ATTRIBUTES`, the types `RenderedAnchor`,
    `RenderedPage` and `PerchPageHelper`, and `window.__perch` declared on `Window`; the report of
    a settled state to an e2e run: `SETTLED_STATE`, `SettledState` and `SettledValue`
    (`contract/REFERENCE.md#rule-page-helper`, `contract/REFERENCE.md#rule-settled-state`).
- `./machines`: a flow in XState, for the check and for an app's own machines. `walk(flow)`
  builds the flow with `setup({ guards, actions, actors }).createMachine`, reaches every state and
  gives the `visited` states and each case with its `expected` and `actual` outcome;
  `casesOfFlow(flow)` the cases the flow says. An app holds a machine of its own to its flow with
  `projected(config)`, `beyondTheSubset(config)`, `aheadOf(app, flow)` and
  `laggingOf(app, flow, base)`, which a branch uses while a business commit runs ahead of the
  implementation (`contract/REFERENCE.md#rule-flow-run`, `contract/REFERENCE.md#rule-ahead-mode`).
- `./testing`: what a package's specs take from the engine, never the code that runs in an app or
  a server. `heldModule({ committed, emit, root, env })` gives the text the module `committed`
  must equal: what `emit` (`valuesModuleOf`, `fieldFactsModuleOf`) makes of the contract of the
  repository at `root` now, or, with `CONTRACT_AHEAD=1` in `env`, `committed` itself when it is
  what `emit` made of the contract at `CONTRACT_AHEAD_BASE` or `CONTRACT_AHEAD_HEAD`; a module
  equal to none is held to the contract now, so the spec asserts
  `expect(committed).toBe(heldModule({ committed, emit, root, env: process.env }))`
  (`contract/REFERENCE.md#rule-emitted-modules`).

## Commands

- `bun run test`: the anchor grammar, the loaders, the reader of the written descriptions, the
  scenario parser and formatter, the schema writer, the reference, the references, the
  contract check, the sources check, the consumers check, the coverage-ignore markers, the
  manifest, the emitted modules, the hand-over diff, the coverage note, the routes view, the
  editions and the migrations, and the walk and comparison of machines.
- `bun run typecheck`, `bun run lint`.
- The commands below are the package's `ui-contract` bin: `src/cli/index.ts` runs `run(argv)`
  of `src/cli/run.ts` (the usage and the dispatch), one file per command beside them.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources, then `contract/REFERENCE.md` from their describe texts and the
  engine's rules; `bun run contract:schemas -- --check` fails on the schemas' drift, and
  `bun run contract:check` on both).
- From the root: `bun run contract:check` (the contract files and the scenarios against each
  other, by the rules of the version the contract declares, every written description against
  its budget, every field hint of the generated schemas against the same budget, the schema drift, the reference's drift and each link of a guide into the
  reference; prints `file:line: message` per
  problem and exits 1, or a one-line summary, followed for a contract older than the engine by
  `ui-contract: the contract is at version <n>; this engine reads up to <m> (bun run contract:migrate)`;
  part of the pre-commit hook on a branch). `ui-contract check --current`, which `bun run check`
  and a commit on `main` run, fails on such a contract instead.
- From the root: `bun run contract:migrate` (`ui-contract migrate [--write]`: each step from the
  version the contract declares to the engine's, `<n> -> <n+1>: <note>`, with the files it
  changes and the work it leaves by hand, `by hand: <work>`; `--write` rewrites those files,
  the text outside the nodes a step edits unchanged, and a second run finds nothing to do).
  Not part of `bun run check`: the check never migrates.
- From the root: `bun run contract:check:sources` (`ui-contract check --sources`: the
  contract check, then the anchors and codes of `apps/web/src` and `packages/ui/src`
  against the contract; prints `file:line: message` per problem and exits 1, or
  `contract: sources agree with the contract (<n> anchors)`; part of `bun run check` and
  of the pre-commit hook on `main`). `bun run contract:check:sources:ahead` (`--sources
  --ahead`) lets the contract run ahead of the app: an anchor declared but not rendered yet
  passes and is counted, a literal the contract lacks still fails; the pre-commit hook runs
  it on every branch but `main`.
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
  `apps/web/dist/ui-manifest/`, its dev watcher into `apps/web/dist-dev/ui-manifest/`.
- `ui-contract emit values|fields|terms --out <file>`, from the root or any folder under it:
  writes the module of plain data `CONTRACT_VALUES`, `FIELD_FACTS` or `CONTRACT_ROLES` with
  `CONTRACT_ROUTES` into `<file>`, relative to the
  working directory, which the caller always names; prints the problems and exits 1, writing
  nothing, when the contract check finds any. From the root, `bun run contract:emit`
  (`turbo run emit`) runs the `emit` script of every package that keeps one. Not part of
  `bun run check`.
- From the root: `bun run contract:diff <ref>` (`ui-contract diff <ref> [--json]`: what the
  contract of the working tree adds, removes and renames against the contract at the git ref
  `<ref>`, all of it as added when that commit has no `contract/`, the composites, the derived
  parts, the codes, the states, the roles and the error fields the anchors both hold gain or
  lose (derived ones included), who each route serves, the source each list reads with its
  params and its paging, the fields that start or
  stop holding input, the messages that rank their codes with their order, the leaving
  actions, how each leave asks, the activities and the
  transitions changed in each, the lines changed in each screen's flow, the platform
  actions with the lines changed in each, its mail among them, the reads each action of the
  model comes to change or stops changing, and each written description
  added, removed or changed with its length before and after, included; prints
  the hand-over block, or the changes as JSON with `--json`). A change to the contract
  carries the output of
  `bun run contract:diff main` in its description.
- From the root: `bun run contract:inflight` (`ui-contract inflight`: the contract of
  `contract/trunk` and of each local `feat/*`, `fix/*`, `chore/*` and `refactor/*` branch, loaded
  with this engine from the refs alone, each printed as OK or with its problems; exits 1 when any
  has one; a branch whose tree is that of its one merge base with `main`, so with nothing `main`
  lacks, is left out as `<branch>: nothing unlanded, left out` and counted apart in the summary;
  one with several merge bases, none, or a failing git call is checked). Not part of
  `bun run check`.
- From the root: `bun run contract:coverage` (`ui-contract coverage [--write | --check]
  [--json] [--unmarked] [--descriptions]`: the coverage block, first the fields and actions of each entity of the
  model with the anchors bound to them and the transitions of each activity its scenarios
  walk, then the controls marked and ignored per feature
  module and for the kit with the unmarked and ignored ones listed, and the anchors and
  scenarios per screen; `--write` puts it between the markers of `contract/COVERAGE.md`,
  `--json` prints the measure, `--unmarked` prints the unmarked controls and the ignored ones
  with their reasons as `file:line: <element>`, `--descriptions` the written descriptions the
  engine would say itself as `<anchor>: <description>`; a coverage-ignore marker without a reason,
  without an element after it or ignoring no control is printed as a problem and exits 1,
  writing nothing). The measure fails nothing: the note is a report. `--check` compares the
  block of `contract/COVERAGE.md` with what `--write` would write: when they differ it prints a
  problem at the line of the block's start marker, naming `bun run contract:coverage --write`,
  and exits 1; when they are equal it says so in one line. `bun run contract:coverage:check`
  runs it, in `bun run check` and in the pre-commit hook on `main` only, as `e2e:coverage` runs
  there.
- From the root: `bun run contract:flow <screen>` (`ui-contract flow <screen> [--json]`: the
  flow of a screen, named by its id or its file, as every reader takes it, expanded from
  the shorter forms its file may write it in, the regions it leaves out derived and the
  default outcome of each request filled in). Not part
  of `bun run check`: it is a view.
- From the root: `bun run contract:routes` (`ui-contract routes [--json]`: the routes of the
  screen files in four sections, the table (path, screen, guard, roles, history, params,
  search, file), one example link per binding, where each route is reached from and the
  tree under `__root`; or the `RoutesView` as JSON with `--json`). Not part of
  `bun run check`: it is a view.
