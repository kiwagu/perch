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

- `.`: the tooling, for Bun.
  - Loaders of the contract files and of the scenarios, each returning problems
    (`file:line: message` through `formatProblem`): `parseVocabulary(markdown)` (the closed
    lists of `contract/vocabulary.md`, one `## ` section each, `VOCABULARY_SECTIONS`; a
    vocabulary without its "Composites" section reads as an empty table),
    `loadScreens(root)` (every `.yaml` file under `contract/domain/screens`, sorted by path, one screen
    each: what it leaves out derived from the model and the platform (`files/derive/`: the
    anchors of the platform's composites its secret inputs opt into with `composite: <name>`,
    the list `<screen>.<list>` and an item `<screen>.<list>.<item>-item` per item right after
    the input, each marked `derivedFrom`, refused for an unknown composite, an opt-in on anything
    but a secret input, a second opt-in of one composite on a screen, an id a written anchor or
    another composite has, and a `derivedFrom` the file writes (`composites.ts`); a button's
    params, for each action it binds the union of those the fields of its part pass to it, a
    param it writes winning key by key, two fields passing one param with different values a
    problem of the button (`form-params.ts`); the failures of the actions; an error's codes, from
    the actions bound beside it, the actions its flow invokes whose failure shows on it and the
    codes the flow shows on it, each once and `failed` last, and its fields (`errors.ts`,
    `flow-errors.ts`); the buttons whose regions the flow leaves out; whether each field holds
    input), its flow expanded from the shorter forms with the codes the anchors of every
    screen carry and the failures of the actions, the default outcome of each request
    (`files/expand-flow/requests.ts` over `files/derive/requests.ts`: an invoke whose action
    fails with codes and that writes no `onError` clears its error on entry, unless its `entry`
    does, and goes back to the one state that entered it on a control, showing the failure on
    `<part>.error` of those controls, of its input's fields when none, else `<screen>.error`,
    and `<screen>.error` when there is no part (no control enters, the input names no field);
    one written as its target alone gets the show; a state where its area starts, one two
    states, an outcome, a platform or a data event or a target from outside its area enter,
    and one with no error are problems that ask for its `onError`), the success of each
    mutation said on the
    frame's toast anchor (a model action by its name, a platform action by the platform's
    `toasts` map), which carries every code a flow shows on it
    (`files/expand-flow/toasts/`, `files/derive/toasts.ts`), and the question before each
    destructive action, on its control (`asks`) and on the frame's confirmation, which
    carries every code asked with (`files/derive/confirmations.ts`, `files/derive/questions.ts`),
    then parsed through
    `screenFileSchema`;
    `loadScreensWith(root, model)` does the same with a model already loaded, as the contract
    check does; named by the path of its first binding: `/me` is
    `me.yaml`, `/org/$org` is `org/$org.yaml`, the frame without a binding is `__root.yaml`;
    and `contract/domain/platform.yaml`, the version and the platform section (its actions,
    events, `leaving` actions, `toasts` (the platform actions whose success toasts, with
    their codes), `unsavedInput` (how each leave that would lose unsaved input asks first),
    `composites` (each a list with its items, their descriptions and their item state, declared
    once for the screens that opt in), reserved anchors and status line), through
    `platformFileSchema`; assembled into one `ScreensFile` whose `files` name the file of each
    screen and whose `toasts` record the toasts the loader derived, problems named by the file and the path inside it, a YAML error by its line),
    `loadModel(root)` (`contract/domain/model.schema.json`, checked against the
    JSON Schema 2020-12 meta-schema, then each `$defs` entity through
    `entityDefinitionSchema`), `loadActivities(root)` (every `.yaml` file under
    `contract/domain/activities`, sorted by path, one activity each through `activitySchema`, its
    file named by its id; the folder is optional, so none is no problem) and
    `loadScenarios(root)` (every `.md` file under
    `tests/e2e/scenarios`, its id the path without `.md`, sorted by that id (an id before the
    ids that extend it, `user/base/sign-up` before `user/base/sign-up-taken-email`), through
    `parseScenario`; a path outside the id grammar or a layer outside `SCENARIO_LAYERS` is a
    problem of its file); both return beside their files `lines`, by id the line of each
    place of the file by its JSON path (`states.profile.on["user.profile.sign-out-button"]`,
    `steps[2]`), which the `Contract` carries as `activityLines` and `scenarioLines`. The
    paths: `CONTRACT_DIR`, `VOCABULARY_FILE`, `SCREENS_DIR`, `PLATFORM_FILE`, `MODEL_FILE`,
    `ACTIVITIES_DIR`, `activityFile(id)`, `SCENARIOS_DIR`, `scenarioFile(id)` and the five
    schema files.
  - The scenario files: `parseScenario(id, markdown)` reads one (a YAML front matter checked
    by `scenarioHeaderSchema`: `tags`, an optional `activity`, `devices`, `data`; then the
    fixed Markdown sections in any order) into a `Scenario` with `lines`, the line of each
    key of the front matter (`devices.A`), each section (`where`) and each list item
    (`steps[0]`), or returns its problems with their lines (`ScenarioProblem`);
    `formatScenario(scenario)` writes one, its inverse.
  - The Zod sources of the files: `screenFileSchema` (a screen as every reader takes it, its
    flow canonical), `authoredScreenFileSchema` (a screen file as written, its flow in the
    shorter forms too: `authoredFlowSchema`, with the region pattern `draftPatternSchema` and
    the region of a button `controlRegionSchema`, its anchors
    those of `authoredAnchorDefSchema`, whose `binding` is a model field, an action, a route or
    `{ search }`, the search parameter a field starts with; the source of
    `contract/schemas/screen.schema.json`), `platformFileSchema`
    and their parts, `platformMailSchema` among them (the mail a platform action sends: `to`
    and `language`, each a parameter of the action or `ACCOUNT`, the signed-in account, a
    reserved word no parameter of an action that sends a mail or a notice takes, and
    the `link` with the `screen` it opens and the `search` parameter carrying its token; the
    type `PlatformMail`) and `platformNoticeSchema` (a notice of the action's `notices`, a mail
    that only tells, with no token: its kebab-case `name`, `to` and `language` as a mail's, `to:
    account` being the account's email as it was before the action changed anything, and an
    optional plain `link` to a `screen`, never a `search`; the type `PlatformNotice`),
    `flowSchema` (a screen's `flow`: the XState v5 machine config subset `createMachine` takes
    as written, each state of the root plain or parallel with its regions, a region's state
    leaving for a state of the root by `#<flow id>.<state>`, its `effectSchema` (a navigate's
    search value a literal or `{ anchor }`, the value a field of the screen holds)
    and `transitionSchema`, with the types `Flow`, `FlowState` (a plain state of the root),
    `FlowParallelState`, `FlowRegion`, `FlowRegionState`, `FlowTransition` and `Effect`),
    `activitySchema` (an activity across screens: an XState v5
    machine config in the subset of the flows without effects or `invoke`, whose states are
    visits to screens, each a dot-free name with `meta.screen` and `meta.address`, with the
    types `Activity`, `ActivityState` and `ActivityTransition`), `flatJsonSchema` (route
    `params` and `search`, with the bounds `z.toJSONSchema` writes: `minimum`, `maximum`,
    `minLength`, `maxLength`, `pattern`; and `examples`, fake values of a parameter for the
    route's example link), `scenarioSchema` (the parsed scenario),
    `entityDefinitionSchema`, `manifestSchema`. `SCHEMA_OUTPUTS`, `writeSchemas(root)` and
    `schemaDrift(root)` turn them into the committed `contract/schemas/screen.schema.json`,
    `platform.schema.json`, `activity.schema.json`, `x-perch.schema.json` and
    `manifest.schema.json` (generated; Biome leaves them as written; `model.schema.json` is
    authored).
  - Ajv for JSON Schema 2020-12: `createValidator()`, `jsonSchemaProblems(file, schema)`,
    `validateAgainst(file, schema, data)`.
  - `referencesIn(text)`: the bracket references of a scenario's text (`[anchor]`,
    `[/route]`, `[code:x]`, `[state:x]`, `[value:x]`, `[mail:<action>]`,
    `[notice:<action>.<name>]`).
  - The contract check: `checkContract(root)` loads the contract files, the activities and the
    scenarios (stopping at their own problems), then runs the cross-checks and `schemaDrift`,
    sorted by file and line; `loadContract(root)` returns the loaded `Contract`. Each rule is
    a function of the `Contract`: `versionProblems`, `vocabularyProblems` (every word of the
    screens is in the vocabulary, every code is used, no choice values for a
    `visibility-button`, whose values its suffix defines, the platform's composites and the
    rows of "Composites" name each other, each item state a row state), `screensProblems` (anchors unique and
    never named like a derived one, entry and names, `secret` on a field alone, a
    `visibility-button` derived by a secret `input` alone), `bindingsProblems` (model fields,
    actions and their params, each an anchor (never a `visibility-button`, which holds no
    input), a constant or a search parameter every route of the screen declares, routes,
    the search parameter a field starts with, one every route of the screen declares, never on
    another kind nor a secret field, sources), `flowProblems` (a flow names states, events
    (never a `visibility-button`, which is presentation only), guards, actions with their
    `input` (taken from no `visibility-button` either), anchors with their codes and bindings
    that exist, a clear's anchor one that carries codes, which then shows none, whatever its
    kind and screen, else a field of its own screen, which it empties (a secret one included;
    never a `visibility-button`), a navigate's search keys of the binding it
    moves to, each value a literal or `{ anchor }`, a field its own screen declares (never a
    `visibility-button` nor a secret field),
    resolves every target as XState does (a state of the root or a deep target
    `<parallel>.<region>.<state>` from the root, a state of its own region or an id target
    `#<flow id>.<state>` of its own flow, whose `id` is a one-segment name the flow declares,
    which the app gives its machine, in a region),
    handles each event of a parallel state in one area, reaches every state, leaves every
    plain state that is not final, and puts the one transition without a guard last) over
    the tree of its states, `flowNodes(flow)` (every state in the order of the file as a
    `FlowNode`: a `RootNode`, `ParallelNode`, `RegionNode` or `RegionStateNode` with its path
    of names and its place in the flow), with `deepTargetOf`, `idTargetOf`, `rootOf`,
    `regionStartsOf` and `deepEnteredOf` (the parts of a `DeepTarget` and an `IdTarget`, the
    state of the root a target lands in, each region at its starting state: a deep target's,
    else the initial, and the region states the deep targets of the root enter),
    `activitiesProblems` (an activity's states visit screens that exist
    at bindings of theirs, its events are anchors of that screen or of the frame, never a
    `visibility-button`, and each
    transition is backed by the flow of the anchor's screen navigating to the target's path,
    or by a link to it; its roles, data, targets, guards, reachability and exits),
    `runsProblems` (every flow and every activity runs in XState as written: the walk of
    `./machines` reaches every state and takes every transition and guarded branch to its
    target with its effects; a machine XState will not build is a problem, never a crash),
    `routesProblems` with `parseRoutePath(path)` (the router's path syntax), `searchProblems`
    (enum controls, `retain`, each example of a parameter against that parameter, Ajv's
    reasons at `bindings[i].params.properties.<name>.examples[j]`, an empty example of a
    path parameter, and a value for each `$param`, else `needs an example` at its property),
    `leavingProblems` (each action of `platform.leaving` exists and is listed once),
    `toastsProblems` (each action of `platform.toasts` is an action of the platform),
    `unsavedInputProblems` (`leaving` comes with `unsavedInput`, whose question is a declared,
    reserved dialog with a code, a confirm-button and a cancel-button that runs no action of
    its own, and actions that ask need an action under `leaving`), `mailsProblems` (the mail a
    platform action declares goes to a parameter of the action or the account, takes its
    language from one or the account, and links to a screen whose every route declares its
    search parameter; an action that sends a mail or a notice has no parameter named
    `account`), `noticesProblems` (the notices of a platform action carry names unique within
    it, go to a parameter of the action or the account, take their language from one or the
    account, and link, when they do, to a screen with a route, every route of which needs no
    parameter: no `$param`, no splat, no required search key)
    and `scenariosProblems` (bracket references, a mail by the platform action that declares
    it, a notice by its action and its name, resolved by `unknownNotice`, a value `show` or `hide` once an input renders a `visibility-button`, roles and the
    activity a scenario names, as problems of each scenario's file). A problem of an activity
    or a scenario is at the line of the deepest part of its path the file holds.
  - The sources check: `collectFromSource(text, file)` reads one file with oxc-parser and
    returns its `Collected` anchors (`data-testid`, `testId` and `*TestId` attributes,
    `testId:` keys, `<NAME>_TEST_ID` constants), the suffixes of its `testIdFor()` calls (each
    with its base when the call writes it as a literal),
    its codes (`data-code`, and the kebab-case values of `code:` keys and `<NAME>_CODES`
    maps; a domain code such as `note:TEXT_REQUIRED` is left out, a `data-code` outside the
    grammar is a problem), its `inputs` (`holdsInput` written as a boolean literal on the
    element that carries a field's anchor as a literal; a prop passed through is let by, any
    other value or place is `HOLDS_INPUT_VALUE` or `HOLDS_INPUT_ANCHOR`) and an anchor built
    at runtime as a problem (`RUNTIME_ANCHOR`, `RUNTIME_SUFFIX`); `scanSources(root)` collects
    the tracked and untracked sources under `SOURCE_ROOTS` (`apps/web/src`,
    `packages/ui/src`) except tests, declarations, generated files, fixtures and snapshots;
    `compareWithContract(collected, screens, vocabulary)` wants each literal declared once,
    the literals equal to the anchors of the screen files, no literal named like another plus
    a suffix, every suffix in the vocabulary and listed in the `derived` of an anchor of the
    contract (of the base itself when it is a literal), so a `visibility-button` no input
    declares is never rendered, and every code a code of the contract
    (`codesOf(vocabulary, screens)`: the vocabulary's rows without the rule row, and the toast
    codes the loader derived), and a `holdsInput` written only as
    `{false}` on a field the contract says holds no input, never on another kind, and on every
    such field rendered (except with `ahead`).
    `ignoreMarkers(text, { program, comments })` reads the coverage-ignore markers of a parsed
    file: `ui-contract-ignore: <reason>` (the element and its subtree) or
    `ui-contract-ignore-self: <reason>` (the element alone), as a line comment in code or as
    the only content of a JSX comment container among JSX children, with only white space
    before the element; each `IgnoreMarker` points at the element after it, and a marker
    whose own reason is shorter than three characters, or in another form, is a fault
    (`IGNORE_WITHOUT_REASON`, `IGNORE_MALFORMED`; `IGNORE_WITHOUT_ELEMENT` when no element
    starts where it points, `IGNORE_NO_CONTROL` when its element, and its subtree for the
    plain form, holds no control).
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
    value in the vocabulary (and `show` or `hide` once an input renders a
    `visibility-button`), as the scenarios check resolves its bracket references.
  - `sortProblems(problems)`: by file and line, stable.
  - The manifest: `buildManifest({ vocabulary, screens, model, activities, scenarios, product,
    now? })` returns the `Manifest` (typed from `manifestSchema`): the vocabulary as tables in
    `contract` with the prose `instructions` for an agent (`instructionsOf`, the anchors and
    states taken from the vocabulary and the platform section) and `derivedParts` (each derived
    suffix with the kind of the part it marks, the meaning of the suffix as its `description`
    and, for a `visibility-button`, its values) and
    `composites` (the vocabulary's table of the platform's composites), the screens verbatim with
    each binding's `example` link (`exampleOf`) and each anchor's description, the written one
    (a secret input's with `(type password)` appended once) or else the one the engine says
    (`files/derive/descriptions.ts`: a heading names its screen, a link with one route binding
    leads to the screen at that path, a secret input holds a secret the user types, an error
    says why the actions beside it, then those its screen's flow invokes against it, did not go
    through, each code with its meaning from the vocabulary), the
    platform section (its `composites` among it) and the activities
    verbatim, the scenarios parsed, `ids` (every declared anchor
    with its kind, its screen and its attributes, `holdsInput` of a field among them, a secret
    input's `composite` and, on the anchors a composite derives, `derivedFrom`), `routeParams`
    and the model document.
    `productInfo(root)` names the product (the root package's version, the commit checked out
    or null). `writeManifest(root, outDir, manifest)` validates it against
    `contract/schemas/manifest.schema.json` with Ajv and returns the problems without writing
    anything, or empties `outDir` (its last segment must be `ui-manifest`, `MANIFEST_DIR`) and
    writes `manifest.json` (two spaces deep, each entry of `ids` on one line, so a search for
    an anchor shows its facts), `manifest.schema.json` and `model.schema.json`.
    `emitManifest(root, outDir)` runs the contract check, writes nothing and returns its
    problems when it finds any, or loads the contract and does all three.
  - The hand-over: `contractAt(ref, root)` reads the contract files, the screen files, the
    activities and the scenarios at a git ref (`git ls-tree`, `git show`) and loads them, or
    returns `{ missing: true }` when that commit has no `contract/`; `diffContracts(before,
    after)` returns the `ContractChanges` (screens, anchors, codes, entities, fields as
    `entity.field`, activities by id and the platform's composites by name, added and
    removed, sorted; an anchor removed and one
    added are a rename when they are the only ones of their screen and kind; on the anchors
    both sides hold, the derived parts as `<anchor>.<suffix>` (a `visibility-button` among
    them), the codes as `<anchor> <code>`, the states as `<anchor> <state>` and an error's
    fields as `<error> <code> -> <field>`, written or derived, and the fields that hold input
    as `<anchor> holds input`;
    the actions of `platform.leaving` added and removed, the entries of
    `platform.unsavedInput` as `<leave>: <how it asks>`, and the notices of the platform
    actions as `<action>.<name>`;
    per activity both sides hold, the transitions added and removed as `<state> on <anchor> ->
    <target>`; per screen both sides hold with a flow on either side, the lines of its flow
    added and removed (a flow one side lacks has none, so a flow added or removed whole shows
    every line; a screen added or removed whole is a change of the screens alone),
    `flowLines(flow)`: `initial <state>`, `<path> address <path> <search as JSON, keys
    sorted>` (those the state's address has), `<path> entry|exit <effect>`, `<path> on
    <event> -> <target> [<guard>] <effects>`, `<path> invoke <action> <input as JSON, keys
    sorted>`, `<path> onDone|onError ...`, `<path> final`, descriptions aside; a guarded
    alternative and an entry or exit effect carry their position, `#<n>`, among more than
    one, as order runs the machine; so a screen file written shorter that loads to the same
    flow shows no change);
    `formatChanges(changes)` prints the block a change hands over: a summary line, then one
    line per list that is not empty, the transitions as `transitions added in <activity>` and
    the lines of a flow as `flow transitions added in <screen>`.
  - The coverage note: `modelCoverage(contract)` lists, per entity of the model, every field
    and action with the anchors whose binding (one or a list) names it, none when it is
    unbound (`ModelCoverage`, `BoundMember`): the first measure, with
    `activityCoverage(contract)`, per activity the scenarios that name it, its transitions
    (one per branch of each `on`) and how many of them those scenarios walk: a step names
    the anchor while its device is at the address of the state the transition leaves, each
    device at the most recent route its texts named in the order of the file (by the lines
    of `scenarioLines`), or at the initial state before any (`ActivityCoverage`). `countControls(text, file)` counts
    the controls of one source file (`CONTROL_TAGS`, or any element with an `onClick`) and
    how many carry an anchor, lists the unmarked ones by line, tag and static label
    (`ControlPlace`), the ones a coverage-ignore marker declares off with its reason
    (whatever they carry), and as problems the markers it cannot apply and the ones that
    ignore no control; `measureCoverage(root)` returns the model's measure, the activities', the
    controls per feature module (`FEATURES_DIR`) and for the kit (`UI_KIT_DIR`,
    `UI_KIT_MODULE`) with the unmarked and ignored ones by file (`FileControl`), per
    screen its anchors and the scenarios that reach it, and the composites the platform
    declares that no anchor opts into (`unusedComposites`); `renderCoverage(measure, totals)`
    (`totalsOf`) prints the block, its totals line `fields bound x/y, actions bound x/y` (then
    `activities n, transitions walked x/y` when the contract has any, with a table of them
    after the model) before the controls marked and ignored, then a line `Note: composite
    <name> is declared and used by no screen.` for each unused composite, a note that fails
    nothing (`compositeNotes(measure)`, internal to the coverage command, which also prints
    them after `--write`), `listControls(measure)` the two
    lists as `file:line: <element>`, and `replaceCoverageBlock(note, block)` puts the block
    between `COVERAGE_START` and `COVERAGE_END` of `COVERAGE_FILE`. The counting method is
    described in `contract/COVERAGE.md`; it is a report, not a rule of the contract. Beside it,
    `listDescriptions(contract)` (`handoff/descriptions.ts`, behind `coverage --descriptions`)
    lists as `<anchor>: <description>` every written description equal to the one the engine
    says itself, for the developer to drop; an anchor a composite derives is never listed.
  - `parameterSample(parameter, slot)`: the value of a route parameter a link carries in a
    `SampleSlot`, `path` or `search`: its first example, else its default, else its first
    enum value, else one built within its `minLength`, `maxLength`, `minimum`, `maximum` and
    a `pattern` of a literal prefix and at most one repeated class, the first of them Ajv
    accepts against the parameter, never empty in a path segment; none when no such value
    can be built.
  - The routes view: `exampleOf(binding)` returns its `RouteExample`, the `params` and
    `search` it is built with and the `link`, a deep link with fake data written the way
    TanStack Router writes a link: each `$param` at `parameterSample(parameter, 'path')`
    (refused when it has none), a `{-$param}` at its first example (refused when empty) or
    left out, a splat `$` left out, each through `encodeURIComponent`; every search key in order
    at its `default`, else its first `enum` value or example, a string bare unless it parses
    as JSON (then quoted), a number or a boolean as JSON, form-encoded as `URLSearchParams`
    does. `routesOf(contract)` returns the `RoutesView`: per binding sorted by path a
    `RouteRow` (its screen, guard, roles, history, parameter and search names, file,
    `example` and `ReachedFrom`: the anchors linking to it, the screens whose flow navigates
    to it, the activity states at its address) and the `tree`; `routeTree(screens)` the
    `RouteNode`s, `ROOT_ROUTE` (`__root`, with the frame's screen) first, then each binding
    depth first under the binding whose path is the longest proper prefix of its own on
    whole segments; `renderRoutes(view)` prints the four sections of `ui-contract routes`.
  - The anchor helpers of `./anchors`, re-exported.
- `./anchors`: the browser-safe helpers. `ANCHOR_PATTERN`, `isAnchor(text)`,
  `segmentsOf(anchor)`, `kindOf(anchor)` (the last dash-separated word of the last segment),
  `screenOf(anchor, screenNames)` (the longest screen name on segment boundaries);
  `testIdFor(base, suffix)`, the only way to build a derived anchor `<base>.<suffix>`,
  `baseOf(anchor, suffixes)`, `isKnownAnchor(anchor, declared, suffixes)`; `CONTRACT_VERSION`.
  The eye of a password input, presentation only: `VISIBILITY_BUTTON` (`visibility-button`, a
  suffix the sources still write as a literal in `testIdFor`), `VISIBILITY_BASE_KIND` (`input`,
  the one kind that renders it) and `VISIBILITY_VALUES` (`show`, `hide`, its `data-value`
  with what each says).
  The page helper's contract: `PAGE_HELPER` (`__perch.ui`), `ANCHOR_ATTRIBUTES` (the
  `data-testid`, `data-state`, `data-code`, `data-id` and `data-value` names), the types
  `RenderedAnchor`, `RenderedPage` and `PerchPageHelper`, and `window.__perch` declared on
  `Window` for any code that imports them.
- `./machines`: a flow in XState, for the check and for an app's own machines.
  `walk(flow)` builds the flow with `setup({ guards, actions, actors }).createMachine` (a stub
  per guard, per effect and per `invoke.src`), reaches every state, a parallel state's regions
  each on its own with the others at their initial, and gives the `visited` states and each
  case with its `expected` and `actual` outcome (handled, state, effects); `casesOfFlow(flow)`
  the cases the flow says. An app holds a machine of its own to its flow with
  `projected(config)` (initial state, states, final states, regions, events with their
  targets and guards, invoke sources, the contract's effects; the app's own actions left
  out), `beyondTheSubset(config)` (what a machine does that the flow subset has no
  counterpart for), `aheadOf(app, flow)` (the flow as far as a machine that lags it has
  come: equal to the machine's projection exactly when it does nothing the flow does not
  say) and `laggingOf(app, flow, base)` (the flow at the branch's base when the machine is
  still exactly that, else `aheadOf`), which a branch uses while a business commit runs ahead
  of the implementation.

## Commands

- `bun run test`: the anchor grammar, the loaders, the scenario parser and formatter, the
  schema writer, the references, the contract check, the sources check, the consumers check,
  the coverage-ignore markers, the manifest, the hand-over diff, the coverage note, the
  routes view, and the walk and comparison of machines.
- `bun run typecheck`, `bun run lint`.
- The commands below are the package's `ui-contract` bin: `src/cli/index.ts` runs `run(argv)`
  of `src/cli/run.ts` (the usage and the dispatch), one file per command beside them.
- From the root: `bun run contract:schemas` (writes the JSON Schemas of the contract files
  from their Zod sources; `bun run contract:schemas -- --check` fails on drift).
- From the root: `bun run contract:check` (the contract files and the scenarios against each
  other and the schema drift; prints `file:line: message` per problem and exits 1, or a
  one-line summary; part of `bun run check` and the pre-commit hook).
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
- From the root: `bun run contract:diff <ref>` (`ui-contract diff <ref> [--json]`: what the
  contract of the working tree adds, removes and renames against the contract at the git ref
  `<ref>`, all of it as added when that commit has no `contract/`, the composites, the derived
  parts, the codes, the states and the error fields the anchors both hold gain or lose
  (derived ones included), the fields that start or
  stop holding input, the leaving actions, how each leave asks, the activities and the
  transitions changed in each, and the lines changed in each screen's flow included; prints
  the hand-over block, or the changes as JSON with `--json`). A change to the contract
  carries the output of
  `bun run contract:diff main` in its description.
- From the root: `bun run contract:coverage` (`ui-contract coverage [--write] [--json]
  [--unmarked] [--descriptions]`: the coverage block, first the fields and actions of each entity of the
  model with the anchors bound to them and the transitions of each activity its scenarios
  walk, then the controls marked and ignored per feature
  module and for the kit with the unmarked and ignored ones listed, and the anchors and
  scenarios per screen; `--write` puts it between the markers of `contract/COVERAGE.md`,
  `--json` prints the measure, `--unmarked` prints the unmarked controls and the ignored ones
  with their reasons as `file:line: <element>`, `--descriptions` the written descriptions the
  engine would say itself as `<anchor>: <description>`; a coverage-ignore marker without a reason,
  without an element after it or ignoring no control is printed as a problem and exits 1,
  writing nothing). Not part of `bun run check`: the note is a report.
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
