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
  '`screens` lists every screen once. Its `id` is the screen name its anchors start with.',
  "`bindings` are its routes in the router's format (TanStack): `path` with static segments, `$param`, `{-$param}` (optional) and `$` (splat); `guard` (`guest` or `authenticated`); `roles`; `params` and `search` as flat JSON Schemas; `history` (`push` or `replace`); `retain` (search parameters kept across navigations). `frame: true` marks the frame around every screen, which has no route.",
  '`entry` lists the anchors present once the screen is open; some are alternatives by state, so wait for the one the state shows.',
  `\`anchors\` maps each declared anchor to its \`kind\`, \`binding\`, \`codes\` (its \`${CODE}\` values), \`dataId\` (what its \`${DATA_ID}\` holds), \`dataValue\` (it or its options carry a \`${VALUE}\` of \`contract.choiceValues\`), \`states\` (its \`${STATE}\` values), \`derived\` (the suffixes it renders as \`<anchor>.<suffix>\`), \`roles\` (who sees it; absent: every role of the screen), \`own\` (shown only on the entries the member owns) and \`source\` (where a list's entries come from).`,
  "A screen's `states` say what each container state shows, its `flow` lists its states and, per event on an anchor, the action it runs and its outcomes (a route, codes, a state), and its `wireframe` is the default state as a Playwright aria snapshot.",
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

const SCENARIOS = [
  '`scenarios` are the end-to-end scenarios in the spec-instruction shape, authored as Markdown files in the e2e tree (`tests/e2e/scenarios/<entity>/<layer>/<slug>.md`: a YAML front matter with `tags`, `devices` and `data`, then the sections `# <title>`, `Where:`, `## Scenario:`, `### Steps` and `### Expected result`) and carried here parsed.',
  `Their fields: \`id\` (the file's path under \`tests/e2e/scenarios/\` without \`.md\`, \`<entity>/<layer>/[<area>/]<slug>\` with the layer one of ${quoted(SCENARIO_LAYERS)}; the test is \`tests/e2e/src/<id>.e2e.spec.ts\`), \`title\`, \`tags\` (\`smoke\` or \`full\`), \`devices\` (a letter per browser with the role it reaches by the end; every device starts as \`guest\`), \`where\`, \`data\` (\`generate\` or a fixed value), \`scenario\`, \`steps\` and \`expected\`.`,
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
    scenarios: SCENARIOS,
  }
}
