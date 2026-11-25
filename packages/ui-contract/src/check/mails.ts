/**
 * Rule 15: the mail a platform action declares goes to a parameter of the action or the account
 * it acts on, speaks the language of a source or of the first of a list of sources that has one,
 * and links to a screen with a route, every route of which declares the search parameter that
 * carries the token. A source is a parameter of the action that holds a language, `account`,
 * `organisation` or `recipient`. `account` is reserved: in a mail or a notice (rule 16,
 * `notices.ts`) it names the account the action acts on, the signed-in account for an action on
 * its own account, else, whoever is signed in, the one its parameters name (an email, a link's
 * token), so an action that sends either has no parameter of that name. `organisation` and
 * `recipient`, a mail's language alone, are reserved on an action that sends a mail.
 * `organisation`, the organisation the action runs in, always has a language, so the action lists
 * its roles, neither guest nor identity among them. `recipient`, the account whose email the mail
 * goes to, has one only when an account has that email, so the mail goes to a parameter; so has an
 * optional parameter left out. In a list the next source speaks when one has none, so only these may
 * be followed, and a list ends with a source that always has one. The recipient written alone, the
 * older form, falls back on the signed-in account, so only signed-in roles run the action.
 */

import { GUEST, IDENTITY } from '../anchors'
import { ACCOUNT, ORGANISATION, type PlatformMail, type Problem, RECIPIENT } from '../files'

import { type Contract, locate } from './contract'
import { searchOf } from './lookups'

/** A platform action, as the check reads it. */
type PlatformAction = Contract['screens']['platform']['actions'][string]

/** Why the mail of `name` names whom it goes to wrongly, as messages; none when it does not. */
function toMessages(name: string, action: PlatformAction, mail: PlatformMail): string[] {
  if (mail.to === RECIPIENT) {
    return [
      `"${RECIPIENT}" names the language of the account a mail goes to, never whom it goes to`,
    ]
  }

  return mail.to === ACCOUNT || Object.hasOwn(action.params, mail.to)
    ? []
    : [`"${mail.to}" is neither a parameter of "${name}" nor account`]
}

/** The source of a language at a place of a mail: its name, and where the check reports it. */
interface LanguageSource {
  readonly source: string
  readonly at: readonly (string | number)[]
}

/** Why `source` is no source of the language of the mail of `name`, as messages; none when it is. */
function sourceMessages(name: string, action: PlatformAction, mail: PlatformMail, source: string) {
  if (source === RECIPIENT) {
    return mail.to === ACCOUNT
      ? [`"${RECIPIENT}" of a mail to account is the account itself: write account`]
      : []
  }

  if (source === ORGANISATION) {
    const { roles } = action

    return roles !== undefined && !roles.includes(GUEST) && !roles.includes(IDENTITY)
      ? []
      : [
          `"${ORGANISATION}" speaks the language of the organisation the action runs in, so "${name}" lists its roles, neither guest nor identity among them`,
        ]
  }

  return source === ACCOUNT || Object.hasOwn(action.params, source)
    ? []
    : [`"${source}" is neither a parameter of "${name}", account, ${ORGANISATION} nor ${RECIPIENT}`]
}

/**
 * Why the mail of `name` names its language wrongly, each message with the place of the source it
 * concerns; none when it does not. A list's source after one that always has a language is never
 * reached; the recipient written alone falls back on the signed-in account.
 */
function languageMessages(
  name: string,
  action: PlatformAction,
  mail: PlatformMail,
): { readonly at: readonly (string | number)[]; readonly message: string }[] {
  const sources: LanguageSource[] =
    typeof mail.language === 'string'
      ? [{ source: mail.language, at: [] }]
      : mail.language.map((source, index) => ({ source, at: [index] }))
  const alone =
    typeof mail.language === 'string' && mail.language === RECIPIENT && mail.to !== ACCOUNT
      ? action.roles !== undefined && !action.roles.includes(GUEST)
        ? []
        : [
            `"${RECIPIENT}" falls back on the signed-in account's language, so "${name}" lists its roles, guest not among them`,
          ]
      : []

  const mayHaveNone = (source: string): boolean =>
    source === RECIPIENT ||
    (Object.hasOwn(action.params, source) && action.params[source]?.optional === true)
  const last = sources.at(-1)
  const unended =
    typeof mail.language !== 'string' &&
    last !== undefined &&
    mayHaveNone(last.source) &&
    mayHaveNone(sources.at(-2)?.source ?? '')
      ? [
          {
            at: last.at,
            message: `"${last.source}" may have no language, so it does not end a list: end it with a source that always has one`,
          },
        ]
      : []

  return [
    ...sources.flatMap(({ source, at }, index) => {
      const before = sources[index - 1]?.source

      return before !== undefined && !mayHaveNone(before)
        ? [
            {
              at,
              message: `"${source}" is never reached: "${before}" always has a language, so it ends the list`,
            },
          ]
        : sourceMessages(name, action, mail, source).map((message) => ({ at, message }))
    }),
    ...unended,
    ...alone.map((message) => ({ at: [], message })),
  ]
}

export function mailsProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return Object.entries(contract.screens.platform.actions).flatMap(([name, action]) => {
    const { mail } = action
    const sends = mail !== undefined || (action.notices ?? []).length > 0
    const reserved =
      sends && Object.hasOwn(action.params, ACCOUNT)
        ? [
            inScreens(
              ['platform', 'actions', name, 'params', ACCOUNT],
              `"${ACCOUNT}" names the account in a mail or a notice, so an action that sends one gives no parameter that name`,
            ),
          ]
        : []

    if (mail === undefined) {
      return reserved
    }

    const at = ['platform', 'actions', name, 'mail'] as const
    const screen = contract.screens.screens.find(
      (each) => each.id === mail.link.screen && each.bindings.length > 0,
    )

    return [
      ...reserved,
      ...(Object.hasOwn(action.params, RECIPIENT)
        ? [
            inScreens(
              ['platform', 'actions', name, 'params', RECIPIENT],
              `"${RECIPIENT}" names the account a mail goes to, in its language, so an action that sends a mail gives no parameter that name`,
            ),
          ]
        : []),
      ...(Object.hasOwn(action.params, ORGANISATION)
        ? [
            inScreens(
              ['platform', 'actions', name, 'params', ORGANISATION],
              `"${ORGANISATION}" names the language of the organisation the action runs in, so an action that sends a mail gives no parameter that name`,
            ),
          ]
        : []),
      ...toMessages(name, action, mail).map((message) => inScreens([...at, 'to'], message)),
      ...languageMessages(name, action, mail).map(({ at: source, message }) =>
        inScreens([...at, 'language', ...source], message),
      ),
      ...(screen === undefined
        ? [inScreens([...at, 'link', 'screen'], `"${mail.link.screen}" is no screen with a route`)]
        : searchOf(screen).has(mail.link.search)
          ? []
          : [
              inScreens(
                [...at, 'link', 'search'],
                `"${mail.link.search}" is not a search parameter of every route of "${mail.link.screen}"`,
              ),
            ]),
    ]
  })
}
