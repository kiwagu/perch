/**
 * Rule 15: the mail a platform action declares goes to a parameter of the action or the account
 * it acts on, speaks the language a parameter of the action holds, that account's or its
 * recipient's, and links to a screen with a route, every route of which declares the search
 * parameter that carries the token. `account` is reserved: in a mail or a notice (rule 16,
 * `notices.ts`) it names the account the action acts on, the signed-in account for an action on
 * its own account, else, whoever is signed in, the one its parameters name (an email, a link's
 * token), so an action that sends either has no parameter of that name. `recipient`, a mail's language alone, is reserved on an action that sends a mail: the
 * account whose email the mail goes to, else the signed-in account, so the mail goes to a
 * parameter and only signed-in roles run the action.
 */

import { ACCOUNT, type PlatformMail, type Problem, RECIPIENT } from '../files'

import { type Contract, locate } from './contract'
import { searchOf } from './lookups'

/** The role of a device nobody is signed in on, which has no account to fall back on. */
const GUEST = 'guest'

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

/** Why the mail of `name` names its language wrongly, as messages; none when it does not. */
function languageMessages(name: string, action: PlatformAction, mail: PlatformMail): string[] {
  if (mail.language !== RECIPIENT) {
    return mail.language === ACCOUNT || Object.hasOwn(action.params, mail.language)
      ? []
      : [`"${mail.language}" is neither a parameter of "${name}", account nor recipient`]
  }

  if (mail.to === ACCOUNT) {
    return [`"${RECIPIENT}" of a mail to account is the account itself: write account`]
  }

  return action.roles !== undefined && !action.roles.includes(GUEST)
    ? []
    : [
        `"${RECIPIENT}" falls back on the signed-in account's language, so "${name}" lists its roles, guest not among them`,
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
      ...toMessages(name, action, mail).map((message) => inScreens([...at, 'to'], message)),
      ...languageMessages(name, action, mail).map((message) =>
        inScreens([...at, 'language'], message),
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
