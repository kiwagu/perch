/**
 * Rule 17: who a route serves. A binding's `roles` are the roles it serves: the router serves it
 * only to an account that holds one of them, after its `guard`, and an account that holds none
 * gets the screen of the binding at `/$`, the not-found screen, at the same address. So a guard
 * never sends away an account its roles name (`authenticated` sends a guest to sign in, so its
 * roles leave `guest` out; `guest` sends a signed-in account away, so its roles name `guest`
 * alone); an anchor's `roles` are among those its screen's bindings serve (the frame, which has
 * no binding, aside); a link to a route that neither a guest nor any signed-in account opens
 * (its roles name neither `guest` nor `identity`) is shown to no device the route refuses: every
 * restriction above the link (its own `roles`, those of each anchor it is declared under, and
 * the roles its screen's bindings serve, the frame aside) admits a device by the roles it holds
 * together (`heldRoles`), so a device every restriction admits holds a role the route serves; and
 * the binding at `/$` serves every account, so its roles name `guest` and `identity`.
 */

import { admits, GUEST, heldRoles, IDENTITY } from '../anchors'
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
 * The restrictions a device passes to see an anchor, each a list of roles that admits a device
 * holding one of them: the anchor's own `roles`, those of each anchor of its screen it is
 * declared under, and the roles its screen's bindings serve (none for the frame, which has no
 * binding). A device sees the anchor when every one admits it.
 */
const restrictionsOf = ({
  anchor,
  def,
  screen,
}: DeclaredAnchor): ReadonlyArray<readonly string[]> => [
  ...(def.roles === undefined ? [] : [def.roles]),
  ...Object.entries(screen.anchors).flatMap(([other, { roles }]) =>
    roles !== undefined && anchor.startsWith(`${other}.`) ? [roles] : [],
  ),
  ...(screen.frame === true ? [] : [servedBy(screen)]),
]

/**
 * A device every restriction admits and `binding` refuses, when one exists: a guest, else a
 * signed-in account holding every role the restrictions name but those `binding` serves
 * (`heldRoles`). Of signed-in accounts, one holding more roles passes every restriction a
 * holder of fewer does, so that account sees the link whenever any refused account does.
 */
function refusedViewer(
  restrictions: ReadonlyArray<readonly string[]>,
  binding: Binding,
): ReadonlySet<string> | undefined {
  const widest = heldRoles(
    true,
    restrictions.flat().filter((role) => !binding.roles.includes(role)),
  )

  return [heldRoles(false), widest].find(
    (held) => restrictions.every((roles) => admits(roles, held)) && !admits(binding.roles, held),
  )
}

/**
 * The fewest roles of `viewer`, a signed-in account every restriction admits, that still pass
 * every restriction: none (`identity` alone), else one, in the order the restrictions name
 * them, else one kept per restriction not yet passed (an `own` role of the link first, then the
 * order the restriction lists them), each dropped again when the ones kept after it suffice.
 */
function fewestRoles(
  restrictions: ReadonlyArray<readonly string[]>,
  own: readonly string[],
  viewer: ReadonlySet<string>,
): ReadonlySet<string> {
  const pass = (held: readonly string[]): boolean =>
    restrictions.every((roles) => admits(roles, heldRoles(true, held)))
  const one = [[], ...[...viewer].filter((role) => role !== IDENTITY).map((role) => [role])].find(
    pass,
  )

  if (one !== undefined) {
    return heldRoles(true, one)
  }

  const kept = restrictions.reduce<string[]>((held, roles) => {
    const role =
      own.find((candidate) => roles.includes(candidate) && viewer.has(candidate)) ??
      roles.find((candidate) => viewer.has(candidate))

    return role === undefined || admits(roles, heldRoles(true, held)) ? held : [...held, role]
  }, [])

  return heldRoles(
    true,
    kept.reduceRight<string[]>((held, role) => {
      const rest = held.filter((other) => other !== role)

      return pass(rest) ? rest : held
    }, kept),
  )
}

/** A link to a route some roles alone open, shown to no device the route refuses. */
function linkProblems(
  declared: DeclaredAnchor,
  routes: ReadonlyMap<string, Binding>,
  inScreens: InScreens,
): Problem[] {
  const { def, at } = declared
  const restrictions = restrictionsOf(declared)

  return bindingRefsOf(def).flatMap(({ ref, at: refAt }) => {
    const binding = 'route' in ref ? routes.get(ref.route) : undefined

    if (binding === undefined || !isRoleLimited(binding)) {
      return []
    }

    const serves = `${binding.path}, which serves ${binding.roles.join(', ')} alone`

    if (restrictions.length === 0) {
      return [inScreens(at, `a link to ${serves}, names who sees it: roles`)]
    }

    const refused = refusedViewer(restrictions, binding)

    if (refused === undefined) {
      return []
    }

    const shown = refused.has(GUEST) ? refused : fewestRoles(restrictions, def.roles ?? [], refused)
    const named =
      def.roles?.find((role) => shown.has(role)) ??
      [...shown].find((held) => held !== IDENTITY) ??
      IDENTITY

    return [
      inScreens(
        def.roles === undefined
          ? [...at, ...refAt, 'route']
          : [...at, 'roles', def.roles.indexOf(named)],
        `"${named}" is shown a link to ${serves}`,
      ),
    ]
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
