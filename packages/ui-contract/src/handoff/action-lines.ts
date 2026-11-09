/**
 * A platform action as lines for the hand-over diff, one per fact it declares: each parameter
 * with its type, its result, each code its failure shows, each role that may run it, the page
 * sizes it answers with its default when it pages, the mail it
 * sends (who it goes to, the language it speaks, the screen its link opens and the search
 * parameter that carries the token) and each notice (its name, who it goes to, its language and
 * the screen of its plain link). The descriptions are left out, as a flow's are; the result
 * stays, as it is what holds once the action succeeds. The diff compares the lines as sets.
 */

import type { Contract } from '../check'

type PlatformAction = Contract['screens']['platform']['actions'][string]

/** The lines of a platform action, none for an action one side lacks. */
export function actionLines(action: PlatformAction | undefined): string[] {
  if (action === undefined) {
    return []
  }

  const { mail } = action

  return [
    ...Object.entries(action.params).map(([name, { type }]) => `param ${name}: ${type}`),
    `result: ${action.result}`,
    ...action.codes.map((code) => `code ${code}`),
    ...(action.roles ?? []).map((role) => `role ${role}`),
    ...(action.paged === undefined
      ? []
      : [`paged by ${action.paged.sizes.join(', ')}, ${action.paged.default} by default`]),
    ...(mail === undefined
      ? []
      : [
          `mail to ${mail.to} language ${mail.language} link ${mail.link.screen}?${mail.link.search}`,
        ]),
    ...(action.notices ?? []).map(
      ({ name, to, language, link }) =>
        `notice ${name} to ${to} language ${language}${link === undefined ? '' : ` link ${link.screen}`}`,
    ),
  ]
}
