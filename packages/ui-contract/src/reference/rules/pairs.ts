/**
 * The rules of a password pair: the overview (the confirmation that names the new password it
 * repeats, the value it takes from it, the guards the loader derives for the two, what is refused)
 * and one rule per meaning of those guards. Each meaning is written once, in `PAIR_MEANINGS`, which
 * its rule and the manifest's instructions read.
 */

import type { ReferenceRule } from '../rule'

/** What each guard of a password pair holds, by the value its derived shape carries. */
export const PAIR_MEANINGS = {
  differs: 'the confirmation is not the same as the confirmed input',
  strays:
    'the confirmation is no longer how the confirmed input begins: a character differs, or it is longer',
  follows: 'the confirmation is how the confirmed input begins, all of it or a part, or is empty',
  breaks: "the confirmed input breaks one of the rules of its composite's list",
} as const

/** The rule of one meaning: the guard derived under `name` as `shape`, and what it holds. */
const meaningRule = (rule: {
  id: string
  title: string
  name: string
  shape: string
  meaning: string
  keys: readonly string[]
}): ReferenceRule => ({
  id: rule.id,
  title: rule.title,
  text: `\`${rule.shape}\`, derived for a password pair as the guard \`${rule.name}\` wherever its flow names it, holds when ${rule.meaning}. The app implements it by its name, as any guard (see the rule \`password-pair\`).`,
  keys: rule.keys,
})

const CONFIRMS_KEYS = [
  'screen.anchors.<name>.confirms',
  'manifest.screens.flow.meta.guards.<name>.confirms',
]

const compositeBreaks = meaningRule({
  id: 'composite-breaks',
  title: 'The confirmed input breaks a rule',
  name: 'passwordBreaksRules',
  shape: '{ composite: breaks }',
  meaning: PAIR_MEANINGS.breaks,
  keys: ['screen.anchors.<name>.composite', 'manifest.screens.flow.meta.guards.<name>.composite'],
})

const pairDiffers = meaningRule({
  id: 'pair-differs',
  title: 'The confirmation differs',
  name: 'passwordsDiffer',
  shape: '{ confirms: differs }',
  meaning: PAIR_MEANINGS.differs,
  keys: CONFIRMS_KEYS,
})

const pairStrays = meaningRule({
  id: 'pair-strays',
  title: 'The confirmation strays',
  name: 'confirmationStrays',
  shape: '{ confirms: strays }',
  meaning: PAIR_MEANINGS.strays,
  keys: CONFIRMS_KEYS,
})

const pairFollows = meaningRule({
  id: 'pair-follows',
  title: 'The confirmation follows',
  name: 'confirmationFollows',
  shape: '{ confirms: follows }',
  meaning: PAIR_MEANINGS.follows,
  keys: CONFIRMS_KEYS,
})

const passwordPair: ReferenceRule = {
  id: 'password-pair',
  title: 'A password pair',
  text: [
    "A form that sets a new password asks for it twice: the new password, a secret `input` that opts into a composite (`composite: password-rules`), and its confirmation, a secret `input` with no binding, never sent, that names it: `confirms: user.reset-password.password-input`. The two are the screen's password pair, one per screen. The confirmation takes the value of the input it confirms (`fieldValueOf`; see the rule `declared-values`), so it is held to the same limits: where the password's value has a `maxLength`, the confirmation's element carries it too.",
    [
      'The loader derives the guards of the pair, on the parsed screen, each under the name a flow uses (`derive/pairs.ts`), each meaning in a rule of its own:',
      '',
      '- `passwordBreaksRules`, `{ composite: breaks }` (see the rule `composite-breaks`);',
      '- `passwordsDiffer`, `{ confirms: differs }` (see the rule `pair-differs`);',
      '- `confirmationStrays`, `{ confirms: strays }` (see the rule `pair-strays`);',
      '- `confirmationFollows`, `{ confirms: follows }` (see the rule `pair-follows`).',
      '',
      "Each is added to the flow's `meta.guards` only when a transition of the flow names it, so every guard declared stays used. The checks, the walk in XState, the manifest and an app's machine read it as any guard, by its name, and the app implements it. `contract:diff` lists each as `guard <name>: confirms <differs|strays|follows>` or `guard <name>: composite breaks`.",
    ].join('\n'),
    'Refused, each at its key: a `confirms` on anything but a secret input, on an input with a binding, or naming anything but another secret input of its screen with a composite; a second `confirms` on a screen, the first making the pair; and a guard of a pair a screen file writes, `{ confirms }` or `{ composite }`, at every version, since only the loader derives one. From version 4 a screen with a pair never writes one of the four names either: a guard written under one of them beside `confirms` is a problem (derived from the confirms; leave it out). Before version 4 a name the screen writes keeps its written guard, and the others are derived. A screen without a `confirms` writes its guards as sentences, these four names included.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.confirms', 'screen.flow.meta.guards'],
}

/** The rules of a password pair: the overview, then each meaning in the order of the guards. */
export const PAIR_RULES: readonly ReferenceRule[] = [
  passwordPair,
  compositeBreaks,
  pairDiffers,
  pairStrays,
  pairFollows,
]
