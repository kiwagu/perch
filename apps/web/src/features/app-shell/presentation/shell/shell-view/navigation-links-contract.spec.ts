/**
 * The links of the navigation are the frame's links of the contract: every anchor of
 * `__root.yaml` under `app-shell.nav` of kind `link` is a link of the navigation, to the route its
 * binding names, shown to the roles it names. On a branch the pre-commit hook sets
 * `CONTRACT_AHEAD=1`: a business commit may add a link before the frame draws it, so the links
 * may lack one the contract added, never hold one it does not say; `bun run check` and `main`
 * want every link.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { CONTRACT_ROLES, CONTRACT_ROUTES } from '@workspace/kernel'
import { type AnchorDef, formatProblem, loadScreens } from '@workspace/ui-contract'
import { GUEST, IDENTITY, sameAdmission } from '@workspace/ui-contract/anchors'

import { NAVIGATION_LINKS } from './navigation-links.view'

const ROOT = join(import.meta.dirname, '../../../../../../../..')
const AHEAD = process.env['CONTRACT_AHEAD'] === '1'

/** The anchors of the navigation's links start so. */
const NAV_LINK = /^app-shell\.nav\.[a-z-]+-link$/

/** The route a link's anchor navigates to, if its binding names one. */
function routeOf(def: AnchorDef): string | undefined {
  const binding = def.binding

  return binding !== undefined && !Array.isArray(binding) && 'route' in binding
    ? binding.route
    : undefined
}

/** A link as the spec holds it: its route and the roles that see it. */
interface Link {
  readonly to: string | undefined
  readonly roles: readonly string[]
}

/**
 * Whether two links are the same: their routes equal, and their roles admit the same devices over
 * `roles`, so `[identity, member, admin]` and `[identity]` are one link (`sameAdmission`).
 */
function sameLink(a: Link, b: Link, roles: readonly string[]): boolean {
  return a.to === b.to && sameAdmission(a.roles, b.roles, roles)
}

describe('the links of the navigation', () => {
  const { screens, problems } = loadScreens(ROOT)
  const frame = screens?.screens.find((screen) => screen.frame === true)
  const contract = Object.fromEntries(
    Object.entries(frame?.anchors ?? {})
      .filter(([anchor, def]) => NAV_LINK.test(anchor) && def.kind === 'link')
      .map(([anchor, def]) => [anchor, { to: routeOf(def), roles: [...(def.roles ?? [])] }]),
  )

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(Object.keys(contract).length).toBeGreaterThan(0)
  })

  it('are the links of the frame, each to its route for its roles', () => {
    const drawn = Object.fromEntries(
      NAVIGATION_LINKS.map(({ testId, to, roles }) => [testId, { to, roles: [...roles] }]),
    )
    const table = AHEAD
      ? Object.fromEntries(Object.entries(contract).filter(([anchor]) => anchor in drawn))
      : contract
    // The roles either side names: no device that holds only other roles tells two links apart.
    const roles = [
      ...new Set([...Object.values(drawn), ...Object.values(table)].flatMap((link) => link.roles)),
    ]

    expect(Object.keys(drawn).sort()).toEqual(Object.keys(table).sort())
    for (const [anchor, link] of Object.entries(drawn)) {
      const expected = table[anchor]

      expect(expected !== undefined && sameLink(link, expected, roles), anchor).toBe(true)
    }
  })

  it('tells a link of other roles apart by admission', () => {
    const roles = [GUEST, IDENTITY, 'member', 'admin']
    const profile: Link = {
      to: CONTRACT_ROUTES['user.profile'],
      roles: [IDENTITY, CONTRACT_ROLES.member, CONTRACT_ROLES.admin],
    }

    expect(
      sameLink({ to: CONTRACT_ROUTES['user.profile'], roles: [IDENTITY] }, profile, roles),
    ).toBe(true)
    expect(sameLink({ to: CONTRACT_ROUTES['user.profile'], roles: [GUEST] }, profile, roles)).toBe(
      false,
    )
    expect(
      sameLink(
        { to: CONTRACT_ROUTES['user.profile'], roles: [CONTRACT_ROLES.member] },
        profile,
        roles,
      ),
    ).toBe(false)
  })
})
