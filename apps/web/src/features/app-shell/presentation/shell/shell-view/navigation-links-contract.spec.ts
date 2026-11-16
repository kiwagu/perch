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

import { type AnchorDef, formatProblem, loadScreens } from '@workspace/ui-contract'

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

describe('the links of the navigation', () => {
  const { screens, problems } = loadScreens(ROOT)
  const frame = screens?.screens.find((screen) => screen.frame === true)
  const contract = Object.fromEntries(
    Object.entries(frame?.anchors ?? {})
      .filter(([anchor, def]) => NAV_LINK.test(anchor) && def.kind === 'link')
      .map(([anchor, def]) => [anchor, { to: routeOf(def), roles: [...(def.roles ?? [])].sort() }]),
  )

  it('load without problems', () => {
    expect(problems.map(formatProblem)).toEqual([])
    expect(Object.keys(contract).length).toBeGreaterThan(0)
  })

  it('are the links of the frame, each to its route for its roles', () => {
    const drawn = Object.fromEntries(
      NAVIGATION_LINKS.map(({ testId, to, roles }) => [testId, { to, roles: [...roles].sort() }]),
    )
    const table = AHEAD
      ? Object.fromEntries(Object.entries(contract).filter(([anchor]) => anchor in drawn))
      : contract

    expect(drawn).toEqual(table)
  })
})
