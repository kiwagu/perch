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
  '`platform.sign-up` makes an account (an email, a password and a name) and signs the device in; `platform.sign-in` signs an existing one in.',
  'One account per browser: a second account, or a second device of the same one, needs a browser context of its own.',
].join(' ')

const SCREEN_MAP = [
  '`screens` lists every screen once. Its `id` is the screen name its anchors start with; its `title` is what a reader calls it and its `description` what it is for.',
  "`bindings` are its routes in the router's format (TanStack): `path` with static segments, `$param`, `{-$param}` (optional) and `$` (splat); `guard` (`guest` or `authenticated`); `roles`; `params` and `search` as flat JSON Schemas; `history` (`push` or `replace`); `retain` (search parameters kept across navigations); `example`, a deep link to the route with fake data, written as the router writes a link: each path parameter at its first `examples` value, every search key at its `default`, else its first `enum` value or example (the app's own links leave out a value equal to its default and reach the same state). `frame: true` marks the frame around every screen, which has no route.",
  "Every binding `path` is a TanStack Router path in the router's own syntax, `params` are its path parameters and `search` its search parameters, and a route is a state address: the same path with the same search reaches the same state after a reload.",
  '`entry` lists the anchors present once the screen is open; some are alternatives by state, so wait for the one the state shows.',
  `\`anchors\` maps each declared anchor to its \`kind\`, \`binding\`, \`codes\` (its \`${CODE}\` values), \`dataId\` (what its \`${DATA_ID}\` holds), \`dataValue\` (it or its options carry a \`${VALUE}\` of \`contract.choiceValues\`), \`states\` (its \`${STATE}\` values), \`derived\` (the suffixes it renders as \`<anchor>.<suffix>\`), \`roles\` (who sees it; absent: every role of the screen), \`own\` (shown only on the entries the member owns) and \`source\` (where a list's entries come from).`,
  "A screen's `states` say what each container state shows, and its `wireframe` is the default state as a Playwright aria snapshot.",
  "A screen's `flow` is an XState v5 machine config: `initial`, `states` with `on` (an event is the user acting on that anchor, or a platform event of `platform.events`), `target`, `guard` (a name of `meta.guards`), `actions` (effects `show` and `navigate`), `invoke` (a model or platform action with its `input`, `onDone`, `onError`), `type: final`, and `meta.address` on a state a route reaches.",
  "A state of the root may be `type: parallel`: its `states` are regions, the screen's independent areas, all active at once, each with its `initial` and its plain states; a target of the root may name a region's state as `<parallel>.<region>.<state>` (the other regions start at their `initial`), a target in a region names a state of that region or, by the flow's `id` (the screen's), a state of the root as `#<flow id>.<state>`, which leaves the parallel state and enters that state afresh, and within a parallel state an event is handled by one region or by the state's own `on`, never by two.",
  'Carry it into `setup({ guards, actions, actors }).createMachine(flow)` unchanged, implementing the guards it names, the two effects and an actor per `invoke.src`.',
  `\`ids\` holds the same anchors flat, each with its screen. On a development or e2e build, \`window.${PAGE_HELPER}.anchors()\` lists the anchors the page renders now, with their attributes and visibility.`,
].join(' ')

const BINDINGS = [
  '`{ "model": "<entity>.<field>" }` shows or edits `model.$defs.<entity>.properties.<field>`.',
  '`{ "action": "<entity>.<action>" }` runs an action of `model.$defs.<entity>.x-perch.actions`; `{ "action": "platform.<name>" }` runs `platform.actions.<name>`. Its `params` name, per parameter, the anchor whose value it takes, or a constant `{ "value": ... }`.',
  '`{ "route": "/path" }` navigates to the path of a binding of some screen.',
  'A list of bindings runs in its order, or one of them by the mode of the screen; the `flow` says which.',
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
  '`activities` are the activities across screens, one file each in `contract/activities/<id>.yaml`, carried here verbatim: which screens form one task, in which order, and what the task carries from one screen to the next.',
  'An activity has an `id`, a `title`, a `description` (what it is for), the `roles` that take part and `data` (what it carries, by name, each with a `description` and, when it is a field of the model, its `model` as `<entity>.<field>`).',
  'The rest is an XState v5 machine config in the subset of the flows, without effects or `invoke`: `initial`, `meta.guards` and `states`, where a state is a visit to a screen: `meta.screen` names the screen (one screen may be visited by several states), `meta.address` the `path` of a binding of that screen (the activity is where its address is), and `type: final` ends the activity.',
  "A state's `on` maps an anchor of its screen or of the frame to where acting on it leads: `target` (the next visit), `guard` and `description`. The activity says where a task leads and the screens do the work: after that anchor, the flow of its screen navigates to the target's address, or the anchor is a link to it (`binding.route`).",
  'Carry each into `setup({ guards }).createMachine(activity)` unchanged, as the flows, implementing the guards it names; a scenario that walks an activity names it in its `activity`.',
].join(' ')

const SCENARIOS = [
  '`scenarios` are the end-to-end scenarios in the spec-instruction shape, authored as Markdown files in the e2e tree (`tests/e2e/scenarios/<entity>/<layer>/[<area>/]<slug>.md`: a YAML front matter with `tags`, an optional `activity`, `devices` and `data`, then the sections `# <title>`, `Where:`, `## Scenario:`, `### Steps` and `### Expected result`) and carried here parsed.',
  `Their fields: \`id\` (the file's path under \`tests/e2e/scenarios/\` without \`.md\`, \`<entity>/<layer>/[<area>/]<slug>\` with the layer one of ${quoted(SCENARIO_LAYERS)}; the test is \`tests/e2e/src/<id>.e2e.spec.ts\`), \`title\`, \`tags\` (\`smoke\` or \`full\`), \`activity\` (the id of the activity of \`activities\` it walks, when it walks one), \`devices\` (a letter per browser with the role it reaches by the end; every device starts as \`guest\`), \`where\`, \`data\` (\`generate\` or a fixed value), \`scenario\`, \`steps\` and \`expected\`.`,
  'Brackets in their text reference the contract: `[<anchor>]` (in `ids`, or derived from one with a suffix of its `derived`), `[/path]` (a route of `screens`), `[code:<code>]`, `[state:<state>]` and `[value:<value>]`.',
  "They are the contract's feedback loop: a scenario that cannot be written from the contract alone (an anchor, a code, a state, a route or a role it would need) names a gap to fix in the contract files, never one to work around in a test.",
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
  }
}
