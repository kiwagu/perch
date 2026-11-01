/**
 * The prose of `contract.instructions`: fixed text for an agent that drives the application,
 * with the anchors, states and attribute names taken from the vocabulary and the platform
 * section, so nothing the contract declares is typed twice.
 */

import { ANCHOR_ATTRIBUTES, kindOf, PAGE_HELPER } from '../anchors'
import type { Platform, Vocabulary } from '../files'
import { SCENARIO_LAYERS } from '../scenarios'

import type { Instructions } from './manifest.types'

const quoted = (names: readonly string[]): string =>
  names.length === 0 ? 'none' : names.map((name) => `\`${name}\``).join(', ')

const { anchor: ID, state: STATE, code: CODE, id: DATA_ID, value: VALUE } = ANCHOR_ATTRIBUTES

function readiness(vocabulary: Vocabulary, platform: Platform, ready: string): string {
  const others = Object.keys(vocabulary.appStates).filter((state) => state !== ready)

  return [
    `Wait for \`[${ID}="${platform.status.anchor}"][${STATE}="${ready}"]\`: the frame and the screen are rendered and a test may act.`,
    `Its other states (${quoted(others)}) are in \`contract.appStates\`: the app is still opening, or it stopped without a screen.`,
    `Then wait for the screen's container to leave \`loading\`: a \`list\`, a \`section\` or a page \`status\` carries one of ${quoted(Object.keys(vocabulary.containerStates))} in \`${STATE}\`.`,
  ].join(' ')
}

const LANGUAGE = [
  'The page renders `en` on the stands, and its wording is not part of the contract.',
  `Assert \`${CODE}\` (\`contract.codes\`), \`${STATE}\`, \`${DATA_ID}\` and \`${VALUE}\`, never text; the only text a test reads is text it entered itself.`,
].join(' ')

const SESSION = [
  'Every scenario starts in a fresh browser context with nobody signed in (`guest`).',
  "What a platform action does is read from `platform.actions.<name>`, the platform file: its `description`, its `result` (what holds once it succeeds), its `codes` (what a failure shows) and, when it sends mails, its `mail` and its `notices`; never assume it from the action's name.",
  'One account per browser: a second account, or a second device of the same one, needs a browser context of its own.',
].join(' ')

const SCREEN_MAP = [
  '`screens` lists every screen once. Its `id` is the screen name its anchors start with; its `title` is what a reader calls it and its `description` what it is for.',
  "`bindings` are its routes in the router's format (TanStack): `path` with static segments, `$param`, `{-$param}` (optional) and `$` (splat); `guard` (`guest` or `authenticated`); `roles`; `params` and `search` as flat JSON Schemas; `history` (`push` or `replace`); `retain` (search parameters kept across navigations); `example`, a deep link to the route with fake data, written as the router writes a link: each path parameter at its first `examples` value, every search key at its `default`, else its first `enum` value or example (the app's own links leave out a value equal to its default and reach the same state). `frame: true` marks the frame around every screen, which has no route.",
  "Every binding `path` is a TanStack Router path in the router's own syntax, `params` are its path parameters and `search` its search parameters, and a route is a state address: the same path with the same search reaches the same state after a reload.",
  '`entry` lists the anchors present once the screen is open; some are alternatives by state, so wait for the one the state shows.',
  `\`anchors\` maps each declared anchor to its \`kind\`, \`binding\`, \`codes\` (its \`${CODE}\` values), \`fields\` (an error's codes, each with the field it concerns, which the error shows under and marks invalid), \`dataId\` (what its \`${DATA_ID}\` holds), \`dataValue\` (it or its options carry a \`${VALUE}\` of \`contract.choiceValues\`), \`states\` (its \`${STATE}\` values), \`derived\` (the suffixes it renders as \`<anchor>.<suffix>\`), \`roles\` (who sees it; absent: every role of the screen), \`own\` (shown only on the entries the member owns) and \`source\` (where a list's entries come from).`,
  "A screen's `states` say what each container state shows, and its `wireframe` is the default state as a Playwright aria snapshot.",
  'A screen\'s `flow` is an XState v5 machine config: `initial`, `states` with `on` (an event is the user acting on that anchor, typing included for a field, a platform event of `platform.events`, or a data event `model.<entity>.<field>`: the stored value of a field the screen shows changed, here or on another device), `target`, `guard` (a name of `meta.guards`), `actions` (effects `show`, `clear` and `navigate`, whose `search` gives each key a literal or `{ "anchor": "<field>" }`, the value that field of the screen holds when the app moves), `invoke` (a model or platform action with its `input`, whose values are as a binding\'s `params`, `onDone`, `onError`), `type: final`, and `meta.address` on a state a route reaches.',
  "A state of the root may be `type: parallel`: its `states` are regions, the screen's independent areas, all active at once, each with its `initial` and its plain states; a target of the root may name a region's state as `<parallel>.<region>.<state>` (the other regions start at their `initial`), a target in a region names a state of that region or, by the flow's `id` (a one-segment name the flow declares, which the app gives its machine), a state of the root as `#<flow id>.<state>`, which leaves the parallel state and enters that state afresh, and within a parallel state an event is handled by one region or by the state's own `on`, never by two.",
  'Carry it into `setup({ guards, actions, actors }).createMachine(flow)` unchanged, implementing the guards it names, the three effects and an actor per `invoke.src`.',
  'A control whose anchor is an event of the flow (a button, a select, a switch) is enabled exactly while a state the machine is in handles that event (`snapshot.can`), and disabled otherwise: a Save disabled while it saves is the flow saying so, never a flag of its own.',
  `A \`visibility-button\` (\`<input>.visibility-button\`, the eye of a password input, in \`contract.derivedParts\`) shows what the input holds as typed, or hides it again: presentation only, it is never an event of a flow and always enabled, and its \`${VALUE}\` names what a click does, \`show\` or \`hide\`.`,
  `\`ids\` holds the same anchors flat, each with its screen. On a development or e2e build, \`window.${PAGE_HELPER}.anchors()\` lists the anchors the page renders now, with their attributes and visibility.`,
].join(' ')

const BINDINGS = [
  '`{ "model": "<entity>.<field>" }` shows or edits `model.$defs.<entity>.properties.<field>`.',
  '`{ "action": "<entity>.<action>" }` runs an action of `model.$defs.<entity>.x-perch.actions`; `{ "action": "platform.<name>" }` runs `platform.actions.<name>`. Its `params` name, per parameter, the anchor whose value it takes, a constant `{ "value": ... }`, or `{ "search": "<name>" }`, the value of that search parameter of the route the screen was opened at.',
  'An action of `platform.actions` that sends a mail declares it under `mail`: `to` (the parameter whose value it goes to, or `account`), `language` (a parameter holding a language, or `account`) and `link` (the `screen` its link opens and the `search` parameter carrying its token); a scenario names it `[mail:<action>]`. Its `notices` are mails that only tell, with no token, each with its `name`, `to` (a parameter, or `account`: the email of the account the action acts on, as it was before the action changed anything), `language` and, optionally, a plain `link` to a `screen` whose routes need no parameter; a scenario names one `[notice:<action>.<name>]`.',
  '`{ "route": "/path" }` navigates to the path of a binding of some screen.',
  '`{ "search": "<name>" }` on a field starts it with the value of that search parameter of the route the screen was opened at, which the user may change; it may sit in a list beside the action the field gives its value to.',
  'A list of bindings runs in its order, or one of them by the mode of the screen; the `flow` says which.',
  "An anchor with `asks` asks the frame's confirmation (`asks.dialog`, with `asks.code`) before its action runs: the app's platform gate opens it, confirm runs the action and cancel does not; a screen builds no dialog of its own for it.",
].join(' ')

const MODEL = [
  '`model` is the data model: a JSON Schema 2020-12 document with one `$defs` entry per entity.',
  "An entity's `x-perch` says its `table`, its `region` (`private`: the account's own data; `tenant`: the current organisation's), its `id` prefix, its `owner` field, `can` (per role, the actions allowed on any entry or only on its own), its `actions` with their parameters, and `unique` and `index`.",
  "A field's `x-perch` says whether it is `readonly`, the entity a `record` points at, and its `crdt`: how concurrent edits merge (`text`, `list`, `counter`, or `none` for the last writer).",
].join(' ')

function notices(platform: Platform): string {
  const messages = platform.reserved.filter((anchor) => kindOf(anchor) === 'message')

  return [
    `The shell's notice (${quoted(messages)}) shows one notice at a time, the latest, and it outlives the page that raised it.`,
    `Find it by its anchor and its \`${CODE}\` together, right after the action that raises it.`,
  ].join(' ')
}

const ACTIVITIES = [
  '`activities` are the activities across screens, one file each in `contract/domain/activities/<id>.yaml`, carried here verbatim: which screens form one task, in which order, and what the task carries from one screen to the next.',
  'An activity has an `id`, a `title`, a `description` (what it is for), the `roles` that take part and `data` (what it carries, by name, each with a `description` and, when it is a field of the model, its `model` as `<entity>.<field>`).',
  'The rest is an XState v5 machine config in the subset of the flows, without effects or `invoke`: `initial`, `meta.guards` and `states`, where a state is a visit to a screen: `meta.screen` names the screen (one screen may be visited by several states), `meta.address` the `path` of a binding of that screen (the activity is where its address is), and `type: final` ends the activity.',
  "A state's `on` maps an anchor of its screen or of the frame to where acting on it leads: `target` (the next visit), `guard` and `description`. The activity says where a task leads and the screens do the work: after that anchor, the flow of its screen navigates to the target's address, or the anchor is a link to it (`binding.route`).",
  'Carry each into `setup({ guards }).createMachine(activity)` unchanged, as the flows, implementing the guards it names; a scenario that walks an activity names it in its `activity`.',
].join(' ')

const SCENARIOS = [
  '`scenarios` are the end-to-end scenarios in the spec-instruction shape, authored as Markdown files in the e2e tree (`tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md`: a YAML front matter with `tags`, an optional `activity`, `devices` and `data`, then the sections `# <title>`, `Where:`, `## Scenario:`, `### Steps` and `### Expected result`) and carried here parsed.',
  `Their fields: \`id\` (the file's path under \`tests/e2e/scenarios/\` without \`.md\`, \`<entity>/<layer>/[<area>/]<slug>\` with the layer one of ${quoted(SCENARIO_LAYERS)}; the test is \`tests/e2e/src/<id>.e2e.spec.ts\`), \`title\`, \`tags\` (\`smoke\` or \`full\`), \`activity\` (the id of the activity of \`activities\` it walks, when it walks one), \`devices\` (a letter per browser with the role it reaches by the end; every device starts as \`guest\`), \`where\`, \`data\` (\`generate\` or a fixed value), \`scenario\`, \`steps\` and \`expected\`.`,
  'Brackets in their text reference the contract: `[<anchor>]` (in `ids`, or derived from one with a suffix of its `derived`), `[/path]` (a route of `screens`), `[code:<code>]`, `[state:<state>]`, `[value:<value>]`, `[mail:<action>]` (a platform action that declares the mail it sends) and `[notice:<action>.<name>]` (a notice of that name the platform action declares).',
  "They are the contract's feedback loop: a scenario that cannot be written from the contract alone (an anchor, a code, a state, a route or a role it would need) names a gap to fix in the contract files, never one to work around in a test.",
].join(' ')

const GAPS = [
  'When the contract cannot say what you need (a state, a region, an event, a value, a route, a role, a code, a shape), stop at that part: build what the contract covers and report a contract gap with your result, as four lines: `Contract gap:` what is needed; `Facet:` which part of the contract cannot say it (the model, a screen file, the platform, the flow subset, an activity, the scenario grammar, a check); `Emulation refused:` the workaround you did not build; `Proposal:` the change to the contract and its cost.',
  'Never hold it in the app or in a test instead: state in a component for a flow state or a region the contract lacks, a value or a route it does not carry, an anchor or a code born in the code or in a test. An emulation is a fork of the model that no check sees and the next build from this manifest loses; the contract is changed first.',
  'The one transient state a component holds is whether a password input shows what it holds, which the `visibility-button` the contract declares on it toggles.',
].join(' ')

export function instructionsOf(
  vocabulary: Vocabulary,
  platform: Platform,
  ready: string,
): Instructions {
  return {
    readiness: readiness(vocabulary, platform, ready),
    language: LANGUAGE,
    session: SESSION,
    screenMap: SCREEN_MAP,
    bindings: BINDINGS,
    model: MODEL,
    notices: notices(platform),
    activities: ACTIVITIES,
    scenarios: SCENARIOS,
    gaps: GAPS,
  }
}
