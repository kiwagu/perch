/**
 * Rule 15: the mail a platform action declares goes to a parameter of the action or the signed-in
 * account, speaks the language a parameter of the action holds or the account's, and links to a
 * screen with a route, every route of which declares the search parameter that carries the token.
 * `account` is reserved: in a mail or a notice (rule 16, `notices.ts`) it names the account, so an
 * action that sends either has no parameter of that name.
 */

import { ACCOUNT, type Problem } from '../files'

import { type Contract, locate } from './contract'
import { searchOf } from './lookups'

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
    const named = (value: string): boolean =>
      value === ACCOUNT || Object.hasOwn(action.params, value)
    const screen = contract.screens.screens.find(
      (each) => each.id === mail.link.screen && each.bindings.length > 0,
    )

    return [
      ...reserved,
      ...(named(mail.to)
        ? []
        : [
            inScreens(
              [...at, 'to'],
              `"${mail.to}" is neither a parameter of "${name}" nor account`,
            ),
          ]),
      ...(named(mail.language)
        ? []
        : [
            inScreens(
              [...at, 'language'],
              `"${mail.language}" is neither a parameter of "${name}" nor account`,
            ),
          ]),
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
