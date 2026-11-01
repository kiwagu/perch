/**
 * Rule 16: the notices a platform action declares, mails that only tell, each go to a parameter
 * of the action or the account, speak the language a parameter of the action holds or the
 * account's, and carry a name no other notice of the action carries; a notice's link opens a
 * screen with a route, every route of which needs no parameter, as the link carries no token and
 * no search (the schema refuses a `search` on it). A scenario names a notice
 * `[notice:<action>.<name>]`, which `unknownNotice` resolves. That `account` is reserved on an
 * action that sends one is rule 15's (`mails.ts`).
 */

import { ACCOUNT, type Binding, type Platform, type Problem } from '../files'

import { type Contract, locate, own } from './contract'
import { parseRoutePath } from './routes'

/** Whether a route needs a parameter a plain link cannot give: a path parameter or a search key. */
const needsParameter = (binding: Binding): boolean =>
  parseRoutePath(binding.path).segments.some(({ kind }) => kind === 'param' || kind === 'splat') ||
  (binding.search?.required ?? []).length > 0

export function noticesProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)

  return Object.entries(contract.screens.platform.actions).flatMap(([name, action]) => {
    const notices = action.notices ?? []
    const named = (value: string): boolean =>
      value === ACCOUNT || Object.hasOwn(action.params, value)

    return notices.flatMap((notice, index) => {
      const at = ['platform', 'actions', name, 'notices', index] as const
      const { link } = notice
      const screen =
        link === undefined
          ? undefined
          : contract.screens.screens.find(
              (each) => each.id === link.screen && each.bindings.length > 0,
            )
      const needing = screen?.bindings.find(needsParameter)

      return [
        ...(notices.findIndex((other) => other.name === notice.name) < index
          ? [
              inScreens(
                [...at, 'name'],
                `"${notice.name}" is the name of another notice of "${name}"`,
              ),
            ]
          : []),
        ...(named(notice.to)
          ? []
          : [
              inScreens(
                [...at, 'to'],
                `"${notice.to}" is neither a parameter of "${name}" nor account`,
              ),
            ]),
        ...(named(notice.language)
          ? []
          : [
              inScreens(
                [...at, 'language'],
                `"${notice.language}" is neither a parameter of "${name}" nor account`,
              ),
            ]),
        ...(link === undefined
          ? []
          : screen === undefined
            ? [inScreens([...at, 'link', 'screen'], `"${link.screen}" is no screen with a route`)]
            : needing === undefined
              ? []
              : [
                  inScreens(
                    [...at, 'link', 'screen'],
                    `the route "${needing.path}" of "${link.screen}" needs a parameter, and a notice's link carries none`,
                  ),
                ]),
      ]
    })
  })
}

/**
 * Why `[notice:<action>.<name>]` names no notice, opening with its `raw` text, or undefined when
 * the platform action declares a notice of that name. The action is what comes before the last
 * dot, since a platform action's name may hold dots and a notice's never does.
 */
export function unknownNotice(platform: Platform, value: string, raw: string): string | undefined {
  const dot = value.lastIndexOf('.')

  if (dot <= 0) {
    return `${raw} is not <action>.<name>`
  }

  const action = value.slice(0, dot)
  const name = value.slice(dot + 1)
  const declared = own(platform.actions, action)

  if (declared === undefined) {
    return `${raw} names no platform action "${action}"`
  }

  return (declared.notices ?? []).some((notice) => notice.name === name)
    ? undefined
    : `${raw} names no notice "${name}" of "${action}"`
}
