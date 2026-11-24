import { describe, expect, it } from 'vitest'

import { screenFileSchema } from '../../schemas'
import type { Screen } from '../screens'

import { type LoadedScreen, withDerivedLinkRoles } from './link-roles'

interface Served {
  readonly id: string
  readonly path?: string
  readonly roles?: readonly (readonly string[])[]
}

/** A screen serving each list of `roles` by a binding of its own at `path`, or the frame. */
function screenOf({ id, path, roles }: Served, anchors: Record<string, unknown> = {}): Screen {
  return screenFileSchema.parse({
    id,
    title: `The ${id} screen`,
    description: `What the ${id} screen is for.`,
    ...(path === undefined ? { frame: true } : {}),
    flag: null,
    bindings:
      path === undefined
        ? []
        : (roles ?? []).map((served, index) => ({
            path: index === 0 ? path : `${path}/${index}`,
            roles: served,
          })),
    entry: [`${id}.page`],
    anchors: { [`${id}.page`]: { kind: 'page' }, ...anchors },
  })
}

const link = (route: string, roles?: readonly string[]) => ({
  kind: 'link',
  binding: { route },
  ...(roles === undefined ? {} : { roles }),
})

const fileOf = (id: string) => `contract/domain/screens/${id}.yaml`

/** The screens as the loader holds them, each with its file. */
const read = (screens: readonly Screen[]): LoadedScreen[] =>
  screens.map((screen) => ({ file: fileOf(screen.id), screen }))

/** The roles the screens get, in their order. */
const derive = (screens: readonly Screen[], edition = 4) =>
  withDerivedLinkRoles(read(screens), edition)

/** `home`, serving guests and accounts, with the links `links`; `me` serves accounts alone. */
function pair(
  links: Record<string, unknown>,
  home: Served = { id: 'home', path: '/home', roles: [['guest', 'identity']] },
): Screen[] {
  return [screenOf(home, links), screenOf({ id: 'me', path: '/me', roles: [['identity']] })]
}

const rolesAt = (screens: readonly Screen[], anchor: string, index = 0) =>
  screens[index]?.anchors[anchor]?.roles

describe('withDerivedLinkRoles', () => {
  it('gives a link the roles of its route when the route admits fewer devices than its screen serves', () => {
    const { screens, problems } = derive(pair({ 'home.me-link': link('/me') }))

    expect(problems).toEqual([])
    expect(rolesAt(screens, 'home.me-link')).toEqual(['identity'])
  })

  it('gives a link to a route that serves every device of its screen no roles', () => {
    const screens = pair({ 'home.back-link': link('/home') })
    const derived = derive(screens)

    expect(derived.problems).toEqual([])
    expect(rolesAt(derived.screens, 'home.back-link')).toBeUndefined()
    expect(derived.screens).toEqual(screens)
  })

  it('gives none to a link whose route admits more than its screen serves', () => {
    const screens = [
      screenOf(
        { id: 'home', path: '/home', roles: [['identity']] },
        { 'home.in-link': link('/open') },
      ),
      screenOf({ id: 'open', path: '/open', roles: [['guest', 'identity', 'member']] }),
    ]

    expect(rolesAt(derive(screens).screens, 'home.in-link')).toBeUndefined()
  })

  it('reads the roles a screen serves from all of its bindings', () => {
    const screens = [
      screenOf(
        { id: 'home', path: '/home', roles: [['guest'], ['identity']] },
        { 'home.me-link': link('/me'), 'home.in-link': link('/home/1') },
      ),
      screenOf({ id: 'me', path: '/me', roles: [['identity']] }),
    ]
    const derived = derive(screens)

    expect(rolesAt(derived.screens, 'home.me-link')).toEqual(['identity'])
    expect(rolesAt(derived.screens, 'home.in-link')).toEqual(['identity'])
  })

  it('serves every role to the frame, so any route that refuses a device gives its link its roles', () => {
    const screens = [
      screenOf(
        { id: 'app-shell' },
        { 'app-shell.me-link': link('/me'), 'app-shell.all-link': link('/all') },
      ),
      screenOf({ id: 'me', path: '/me', roles: [['identity']] }),
      screenOf({ id: 'all', path: '/all', roles: [['guest', 'identity']] }),
    ]
    const derived = derive(screens)

    expect(rolesAt(derived.screens, 'app-shell.me-link')).toEqual(['identity'])
    expect(rolesAt(derived.screens, 'app-shell.all-link')).toBeUndefined()
  })

  it('gives a route that admits a device its screen does not, and refuses another, its roles', () => {
    const screens = [
      screenOf({ id: 'home', path: '/home', roles: [['guest']] }, { 'home.op-link': link('/op') }),
      screenOf({ id: 'op', path: '/op', roles: [['operator']] }),
    ]

    expect(rolesAt(derive(screens).screens, 'home.op-link')).toEqual(['operator'])
  })

  it('leaves the screens it was given as they were', () => {
    const screens = pair({ 'home.me-link': link('/me') })
    const before = structuredClone(screens)

    derive(screens)

    expect(screens).toEqual(before)
  })

  describe('from version 4 a file never writes them', () => {
    it('refuses roles equal to those of the route by admission, a role held beside identity included', () => {
      const { problems } = derive(
        pair({ 'home.me-link': link('/me', ['identity', 'member', 'admin']) }),
      )

      expect(problems).toEqual([
        {
          file: fileOf('home'),
          message:
            'anchors["home.me-link"].roles: roles are derived from the route "/me"; leave them out',
        },
      ])
    })

    it("refuses roles that equal the route's exactly", () => {
      expect(derive(pair({ 'home.me-link': link('/me', ['identity']) })).problems).toHaveLength(1)
    })

    it('keeps roles that admit fewer devices than the route, and roles the route does not derive', () => {
      const written = pair({
        'home.me-link': link('/me', ['admin']),
        'home.back-link': link('/home', ['guest']),
        'home.wide-link': link('/me', ['guest', 'identity']),
      })
      const derived = derive(written)

      expect(derived.problems).toEqual([])
      expect(rolesAt(derived.screens, 'home.me-link')).toEqual(['admin'])
      expect(rolesAt(derived.screens, 'home.back-link')).toEqual(['guest'])
      expect(rolesAt(derived.screens, 'home.wide-link')).toEqual(['guest', 'identity'])
    })

    it('files the problem under the file of the screen that writes it', () => {
      const screens = [
        screenOf({ id: 'home', path: '/home', roles: [['guest', 'identity']] }),
        screenOf(
          { id: 'me', path: '/me', roles: [['identity']] },
          {
            'me.home-link': link('/home', ['guest', 'identity']),
            'me.out-link': link('/out', ['guest']),
          },
        ),
        screenOf({ id: 'out', path: '/out', roles: [['guest']] }),
      ]

      expect(derive(screens).problems).toEqual([
        {
          file: fileOf('me'),
          message:
            'anchors["me.out-link"].roles: roles are derived from the route "/out"; leave them out',
        },
      ])
    })
  })

  describe('before version 4 the contract reads as it did', () => {
    it.each([1, 2, 3])('derives none and accepts what is written at version %i', (edition) => {
      const screens = pair({
        'home.me-link': link('/me'),
        'home.written-link': link('/me', ['identity', 'member', 'admin']),
      })
      const derived = derive(screens, edition)

      expect(derived.problems).toEqual([])
      expect(derived.screens).toEqual(screens)
    })
  })

  it('leaves alone a link of no route we know, of several bindings, any other binding and any other kind', () => {
    const anchors = {
      'home.lost-link': link('/nowhere'),
      'home.many-link': {
        kind: 'link',
        binding: [{ route: '/me' }, { route: '/home' }],
      },
      'home.save-button': { kind: 'button', binding: { route: '/me' } },
      'home.plain-link': { kind: 'link' },
    }
    const screens = pair(anchors)

    expect(derive(screens)).toEqual({ screens, problems: [] })
  })
})
