/**
 * What a platform action answers: its outcome lines, the condition each of its codes answers on,
 * and the invariants several actions keep, each said once.
 */

import type { ReferenceRule } from '../rule'

const actionOutcomes: ReferenceRule = {
  id: 'action-outcomes',
  title: 'What an action answers: its outcomes, its codes and the invariants',
  text: [
    'A platform action says what it answers in two places. Its `result` is what holds once it runs: one outcome, or a list of outcome lines, the plain success first, then each other outcome under its own condition (`with the second factor on: asks for a code and signs no device in`). Its `codes` map each code a failure shows to when it answers: a condition, as the server judges it when the request is admitted (`invalid-code: the code is wrong or used up`), or the invariants it refuses for, rules several actions keep, each said once under `platform.invariants`: `{ invariant: <name> }`, or `{ invariant: [<name>, <name>] }` for two or more, each once, with `condition: <text>` beside them for a cause of the code that is no invariant (`rate-limited: { invariant: [failed-sign-ins, address-mails], condition: a fourth change by the account within a quarter of an hour }`). Each outcome line, a `result` of one string included, each condition and each rule keeps 200 characters, the budget of a description (`behaviourTextsProblems`). A contract before version 6 may write the older forms, `codes` as a list of their names, which says no condition, and a longer `result` of one string; from version 6 the check refuses both (`actionFormsProblems`, `behaviourTextsProblems`).',
    "An invariant, `platform.invariants.<name>`, writes its `rule` and the code it `refuses` with. An action names it under that code, alone or among others, and nowhere else: the engine derives the actions an invariant limits (`invariantActions`), by name, and the manifest carries them under the invariant as `actions`. `contract:check` holds them (`invariantsProblems`): each invariant an action names exists, and its `refuses` is the code it is named under, both at that code; an invariant no action names is refused, at the invariant. The vocabulary's Codes table keeps what each code means to the user; the rule behind a refusal is its invariant's.",
    'The hand-over diff lists each outcome line as `result: <line>`, by its position when there are several (`result #2: <line>`, so a reorder shows), each code as `code <code>: "<condition>"`, `code <code>: invariant <name>`, `code <code>: invariant <name>, <name>`, or, with a condition beside them, `code <code>: invariant <name>; "<condition>"` (the condition quoted, so a text never reads as the invariants a code names), and each invariant as `invariant lines added in <name>` and `invariant lines removed in <name>`, its `rule: <text>` and `refuses <code>`.',
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
