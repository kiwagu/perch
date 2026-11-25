/**
 * A platform action as lines for the hand-over diff, one per fact it declares: each parameter
 * with its type or the value it refers to, the constraints it writes (`valueWords`) and whether
 * it may be left out, each line of its result (with its position when there are several), each code its failure shows with the invariants it
 * refuses for and the condition it answers on (quoted, so a text never reads as invariants), each role that may run it, the page
 * sizes it answers with its default when it pages, each read it changes, the mail it
 * sends (who it goes to, the sources of its language in order, the screen its link opens and the search
 * parameter that carries the token) and each notice (its name, who it goes to, its language and
 * the screen of its plain link). The descriptions are left out, as a flow's are; the result
 * stays, as it is what holds once the action succeeds. The diff compares the lines as sets.
 */

import type { Contract } from '../check'
import { codeEntriesOf, languageSources, outcomesOf } from '../files'

import { valueWords } from './value-words'

type PlatformAction = Contract['screens']['platform']['actions'][string]

type PlatformParameter = PlatformAction['params'][string]

/** A parameter's line: its type or its value, then its constraints, and `optional` when it is. */
function parameterLine(name: string, parameter: PlatformParameter): string {
  const words = [
    ...(parameter.type === undefined ? [] : [parameter.type]),
    ...(parameter.value === undefined ? [] : [`value ${parameter.value}`]),
    ...[...valueWords(parameter, ['type'])].map(([keyword, word]) => `${keyword} ${word}`),
    ...(parameter.optional === true ? ['optional'] : []),
  ]

  return `param ${name}: ${words.join(', ')}`
}

/**
 * The reads an action changes, a platform action's or one of the model's, a line each:
 * `changes <read>`; none where it says none, or nothing.
 */
export const changesLines = (changes: readonly string[] | undefined): string[] =>
  (changes ?? []).map((read) => `changes ${read}`)

/**
 * The lines of an action's outcomes: `result: <line>` for one, and for several each with its
 * position, `result #<n>: <line>`, since the first is the plain success and the diff compares
 * the lines as sets, so a reorder alone shows.
 */
const resultLines = (outcomes: readonly string[]): string[] =>
  outcomes.length === 1
    ? outcomes.map((outcome) => `result: ${outcome}`)
    : outcomes.map((outcome, index) => `result #${index + 1}: ${outcome}`)

/** The lines of a platform action, none for an action one side lacks. */
export function actionLines(action: PlatformAction | undefined): string[] {
  if (action === undefined) {
    return []
  }

  const { mail } = action

  return [
    ...Object.entries(action.params).map(([name, parameter]) => parameterLine(name, parameter)),
    ...resultLines(outcomesOf(action.result)),
    ...codeEntriesOf(action.codes).map(({ code, condition, invariants }) => {
      const answers = [
        ...(invariants.length > 0 ? [`invariant ${invariants.join(', ')}`] : []),
        ...(condition === undefined ? [] : [JSON.stringify(condition)]),
      ]

      return answers.length === 0 ? `code ${code}` : `code ${code}: ${answers.join('; ')}`
    }),
    ...(action.roles ?? []).map((role) => `role ${role}`),
    ...(action.paged === undefined
      ? []
      : [`paged by ${action.paged.sizes.join(', ')}, ${action.paged.default} by default`]),
    ...changesLines(action.changes),
    ...(mail === undefined
      ? []
      : [
          `mail to ${mail.to} language ${languageSources(mail.language).join(', ')} link ${mail.link.screen}?${mail.link.search}`,
        ]),
    ...(action.notices ?? []).map(
      ({ name, to, language, link }) =>
        `notice ${name} to ${to} language ${language}${link === undefined ? '' : ` link ${link.screen}`}`,
    ),
  ]
}

type PlatformInvariant = NonNullable<Contract['screens']['platform']['invariants']>[string]

/** The lines of an invariant: its rule and the code it refuses with; none for one a side lacks. */
export const invariantLines = (invariant: PlatformInvariant | undefined): string[] =>
  invariant === undefined ? [] : [`rule: ${invariant.rule}`, `refuses ${invariant.refuses}`]
