/**
 * What a platform action answers: its outcome lines, the condition each of its codes answers on,
 * and the invariants several actions keep, each said once.
 */

import type { ReferenceRule } from '../rule'

const actionOutcomes: ReferenceRule = {
  id: 'action-outcomes',
  title: 'What an action answers: its outcomes, its codes and the invariants',
  text: [
    'A platform action says what it answers in two places. Its `result` is what holds once it runs: one outcome, or a list of outcome lines, the plain success first, then each other outcome under its own condition (`with the second factor on: asks for a code and signs no device in`). Its `codes` map each code a failure shows to when it answers: a condition, as the server judges it when the request is admitted (`invalid-code: the code is wrong or used up`), or `{ invariant: <name> }`, a rule several actions keep, said once under `platform.invariants`. Each line of a list `result`, each condition and each rule keeps 200 characters, the budget of a description (`behaviourTextsProblems`). The older form of `codes`, a list of their names, still loads and says no condition.',
    "An invariant, `platform.invariants.<name>`, writes its `rule` and the code it `refuses` with. An action names it under that code, and nowhere else: the engine derives the actions an invariant limits (`invariantActions`), in the order the platform file writes them, and the manifest carries them under the invariant as `actions`. `contract:check` holds them (`invariantsProblems`): an invariant an action names exists, and its `refuses` is the code it is named under, both at that code; an invariant no action names is refused, at the invariant. The vocabulary's Codes table keeps what each code means to the user; the rule behind a refusal is its invariant's.",
    'The hand-over diff lists each outcome line as `result: <line>`, each code as `code <code>: <condition>` or `code <code>: invariant <name>`, and each invariant as `invariant lines added in <name>` and `invariant lines removed in <name>`, its `rule: <text>` and `refuses <code>`.',
  ].join('\n\n'),
  keys: [
    'platform.actions.<name>.result',
    'platform.actions.<name>.codes',
    'platform.invariants',
    'platform.invariants.<name>',
    'manifest.platform.invariants.<name>.actions',
  ],
}

/** The rules of what a platform action answers. */
export const ANSWER_RULES: readonly ReferenceRule[] = [actionOutcomes]
