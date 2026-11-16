/**
 * The rule of a password pair: the confirmation that names the new password it repeats, the value
 * it takes from it and the four guards the loader derives for the two.
 */

import type { ReferenceRule } from '../rule'

const passwordPair: ReferenceRule = {
  id: 'password-pair',
  title: 'A password pair',
  text: [
    "A form that sets a new password asks for it twice: the new password, a secret `input` that opts into a composite (`composite: password-rules`), and its confirmation, a secret `input` with no binding, never sent, that names it: `confirms: user.reset-password.password-input`. The two are the screen's password pair, one per screen. The confirmation takes the value of the input it confirms (`fieldValueOf`; see the rule `declared-values`), so it is held to the same limits: where the password's value has a `maxLength`, the confirmation's element carries it too.",
    [
      'The loader derives the guards of the pair, on the parsed screen, each under the name a flow uses (`derive/pairs.ts`):',
      '',
      "- `passwordBreaksRules`, `{ composite: breaks }`: the input the confirmation confirms breaks one of the rules of its composite's list;",
      '- `passwordsDiffer`, `{ confirms: differs }`: the confirmation is not the same as the input it confirms;',
      '- `confirmationStrays`, `{ confirms: strays }`: the confirmation is no longer how the input it confirms begins: a character differs, or it is longer;',
      '- `confirmationFollows`, `{ confirms: follows }`: the confirmation is how the input it confirms begins, all of it or a part, or is empty.',
      '',
      "Each is added to the flow's `meta.guards` only when a transition of the flow names it, so every guard declared stays used. The checks, the walk in XState, the manifest and an app's machine read it as any guard, by its name, and the app implements it. `contract:diff` lists each as `guard <name>: confirms <differs|strays|follows>` or `guard <name>: composite breaks`.",
    ].join('\n'),
    'Refused, each at its key: a `confirms` on anything but a secret input, on an input with a binding, or naming anything but another secret input of its screen with a composite; a second `confirms` on a screen, the first making the pair; and a guard of a pair a screen file writes, `{ confirms }` or `{ composite }`, at every version, since only the loader derives one. From version 4 a screen with a pair never writes one of the four names either: a guard written under one of them beside `confirms` is a problem (derived from the confirms; leave it out). Before version 4 a name the screen writes keeps its written guard, and the others are derived. A screen without a `confirms` writes its guards as sentences, these four names included.',
  ].join('\n\n'),
  keys: ['screen.anchors.<name>.confirms', 'screen.flow.meta.guards'],
}

/** The rules of a password pair. */
export const PAIR_RULES: readonly ReferenceRule[] = [passwordPair]
