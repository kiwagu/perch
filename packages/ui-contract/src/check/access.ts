/**
 * Rule 17: who a route serves. A binding's `roles` are the roles it serves: the router serves it
 * only to an account that holds one of them, after its `guard`, and an account that holds none
 * gets the screen of the binding at `/$`, the not-found screen, at the same address. So a guard
 * never sends away an account its roles name (`authenticated` sends a guest to sign in, so its
 * roles leave `guest` out; `guest` sends a signed-in account away, so its roles name `guest`
 * alone); an anchor's `roles` are among those its screen's bindings serve (the frame, which has
 * no binding, aside); a link to a route that neither a guest nor any signed-in account opens
 * (its roles name neither `guest` nor `identity`) is shown only to the roles it serves, which the
 * link names itself, or the nearest anchor it is declared under, or else its screen's bindings;
 * and the binding at `/$` serves every account, so its roles name `guest` and `identity`.
 */

import { GUEST, IDENTITY } from '../anchors'
import type { Binding, Problem, Screen } from '../files'

import {
  bindingRefsOf,
  type Contract,
  type DeclaredAnchor,
  declaredAnchors,
  type InScreens,
  locate,
} from './contract'

/** The path of the binding that opens the not-found screen. */
const NOT_FOUND_PATH = '/$'

/** The roles the bindings of `screen` serve, in the order first written. */
const servedBy = (screen: Screen): string[] => [
  ...new Set(screen.bindings.flatMap(({ roles }) => roles)),
]

/** Whether a binding serves some roles alone: neither a guest nor any signed-in account. */
const isRoleLimited = (binding: Binding): boolean =>
  !binding.roles.includes(GUEST) && !binding.roles.includes(IDENTITY)

/** A guard that sends away an account the binding's roles name, as the header says. */
function guardProblems(
  binding: Binding,
  at: readonly PropertyKey[],
  inScreens: InScreens,
): Problem[] {
  const others = binding.roles.filter((role) => role !== GUEST)

  if (binding.guard === 'authenticated' && binding.roles.includes(GUEST)) {
    return [
      inScreens(
        [...at, 'guard'],
        '"authenticated" sends a guest to sign in, but its roles name guest: leave guest out of the roles, or the guard out',
      ),
    ]
  }

  return binding.guard === 'guest' && others.length > 0
    ? [
        inScreens(
          [...at, 'guard'],
          `"guest" sends a signed-in account to the profile, but its roles name ${others.join(', ')}: a route for guests alone names guest alone`,
        ),
      ]
    : []
}

/** The roles of each binding of each screen: its guard, and the binding at `/$`. */
function bindingProblems(contract: Contract, inScreens: InScreens): Problem[] {
  const { screens } = contract.screens
  const notFound = screens.flatMap((screen, index) =>
    screen.bindings.flatMap((binding, at) =>
      binding.path === NOT_FOUND_PATH ? [{ binding, at: ['screens', index, 'bindings', at] }] : [],
    ),
  )

  return [
    ...screens.flatMap((screen, index) =>
      screen.bindings.flatMap((binding, at) =>
        guardProblems(binding, ['screens', index, 'bindings', at], inScreens),
      ),
    ),
    ...(notFound.length === 0
      ? [
          inScreens(
            ['screens', 0],
            `no screen has a binding at "${NOT_FOUND_PATH}": an account a binding's roles miss gets that screen`,
          ),
        ]
      : notFound.flatMap(({ binding, at }) =>
          binding.roles.includes(GUEST) && binding.roles.includes(IDENTITY)
            ? []
            : [
                inScreens(
                  [...at, 'roles'],
                  `the binding at "${NOT_FOUND_PATH}" opens the not-found screen for every account: its roles name guest and identity`,
                ),
              ],
        )),
  ]
}

/** An anchor's roles among those its screen's bindings serve; the frame has none to hold to. */
function anchorRolesProblems({ def, screen, at }: DeclaredAnchor, inScreens: InScreens): Problem[] {
  const served = servedBy(screen)

  return screen.frame === true
    ? []
    : (def.roles ?? []).flatMap((role, index) =>
        served.includes(role)
          ? []
          : [
              inScreens(
                [...at, 'roles', index],
                `"${role}" is a role of no binding of the screen (${served.join(', ')})`,
              ),
            ],
      )
}

/**
 * Who sees an anchor, and whether it writes that itself: its own `roles`, else those of the
 * nearest anchor of its screen it is declared under, else the roles its screen's bindings serve.
 */
function shownTo({ anchor, def, screen }: DeclaredAnchor): {
  readonly roles: readonly string[]
  readonly own: boolean
} {
  if (def.roles !== undefined) {
    return { roles: def.roles, own: true }
  }

  const [above] = Object.entries(screen.anchors)
    .filter(([other, { roles }]) => roles !== undefined && anchor.startsWith(`${other}.`))
    .sort(([one], [other]) => other.length - one.length)

  return { roles: above?.[1].roles ?? servedBy(screen), own: false }
}

/** A link to a route some roles alone open, shown only to those roles. */
function linkProblems(
  declared: DeclaredAnchor,
  routes: ReadonlyMap<string, Binding>,
  inScreens: InScreens,
): Problem[] {
  const { def, at } = declared

  return bindingRefsOf(def).flatMap(({ ref, at: refAt }) => {
    const binding = 'route' in ref ? routes.get(ref.route) : undefined

    if (binding === undefined || !isRoleLimited(binding)) {
      return []
    }

    const { roles, own } = shownTo(declared)
    const serves = `${binding.path}, which serves ${binding.roles.join(', ')} alone`

    if (roles.length === 0) {
      return [inScreens(at, `a link to ${serves}, names who sees it: roles`)]
    }

    return roles.flatMap((role, index) =>
      binding.roles.includes(role)
        ? []
        : [
            inScreens(
              own ? [...at, 'roles', index] : [...at, ...refAt, 'route'],
              `"${role}" is shown a link to ${serves}`,
            ),
          ],
    )
  })
}

export function accessProblems(contract: Contract): Problem[] {
  const inScreens = locate(contract.screens)
  const routes = new Map(
    contract.screens.screens.flatMap(({ bindings }) =>
      bindings.map((binding) => [binding.path, binding] as const),
    ),
  )

  return [
    ...bindingProblems(contract, inScreens),
    ...declaredAnchors(contract.screens).flatMap((declared) => [
      ...anchorRolesProblems(declared, inScreens),
      ...linkProblems(declared, routes, inScreens),
    ]),
  ]
}
