// @vitest-environment jsdom
/**
 * Who each screen is for: every binding of the UI contract the app routes (a binding still
 * waiting for its route is `routes-contract.spec.ts`'s case, which a branch lets wait), opened by
 * a device holding each set of roles below, at its example link and, when it has a search, at a
 * search its schema refuses. A binding serves a set its `roles` admit (`admits`), its search
 * read then, so a refused one is the search's error; a set they do not admit is sent away by the
 * binding's guard where it has one (a guest to sign-in, an account to its profile), which only
 * ever sends away a set the roles leave out, and otherwise gets the not-found screen at the same
 * address, its search never read, which the frame reads as the screen at `/$`.
 */

import { join } from 'node:path'

import { createMemoryHistory, defaultStringifySearch } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import { type Binding, bindingSchema, exampleOf, loadScreens } from '@workspace/ui-contract'
import { admits, GUEST, heldRoles, IDENTITY } from '@workspace/ui-contract/anchors'
import { z } from '@workspace/zod'

import { modules } from '../modules'

import { bindingsAtBase, bindingsOf, heldBindings } from './__fixtures__/route-bindings'
import { holding } from './__fixtures__/router'
import { defineModule, type ModuleDef } from './module'
import { resolvedRoute } from './resolved-route'
import { allModules, createAppRouter, HOME_PATH, SIGN_IN_PATH } from './router'

const ROOT = join(import.meta.dirname, '../../../..')

/** The sets of roles a device holds that every binding is opened with. */
const ROLE_SETS: readonly (readonly string[])[] = [
  [GUEST],
  [IDENTITY],
  [IDENTITY, 'member'],
  [IDENTITY, 'admin'],
  [IDENTITY, 'operator'],
]

/** The path of the binding that opens the not-found screen. */
const NOT_FOUND_PATH = '/$'

/** An address only the not-found screen's splat takes. */
const UNKNOWN_ADDRESS = '/no-such-page'

/** What a device sees at an address. */
type Outcome =
  | { readonly kind: 'served' }
  | { readonly kind: 'search-refused' }
  | { readonly kind: 'not-found' }
  | { readonly kind: 'sent-to'; readonly path: string }

/** Where the binding's guard sends a device holding `held`, if it does. */
function sentTo(binding: Binding, held: ReadonlySet<string>): string | undefined {
  if (binding.guard === 'authenticated' && !held.has(IDENTITY)) {
    return SIGN_IN_PATH
  }

  return binding.guard === 'guest' && held.has(IDENTITY) ? HOME_PATH : undefined
}

/** What the rule above says a device holding `held` sees at the binding, at a search taken or refused. */
function expected(binding: Binding, held: ReadonlySet<string>, refused: boolean): Outcome {
  if (admits(binding.roles, held)) {
    return { kind: refused ? 'search-refused' : 'served' }
  }

  const away = sentTo(binding, held)

  return away === undefined ? { kind: 'not-found' } : { kind: 'sent-to', path: away }
}

/** The address of a binding's example link; a root splat's, which the start route takes, at one segment. */
function exampleAddress(binding: Binding): string {
  const { link } = exampleOf(binding)

  return link === '/' && binding.path !== '/' ? UNKNOWN_ADDRESS : link
}

/** A value of the wrong type for a search parameter: a number for a string, a word for the others. */
const wrongValue = (type: string): string | number => (type === 'string' ? 123 : 'not-a-value')

/**
 * The address of the binding's example with its first search parameter of the wrong type, which
 * its schema refuses; none when the binding has no search.
 */
function refusedAddress(binding: Binding): string | undefined {
  const [first] = Object.entries(binding.search?.properties ?? {})

  if (first === undefined) {
    return undefined
  }

  const [name, parameter] = first
  const { search } = exampleOf(binding)
  const [path = ''] = exampleAddress(binding).split('?')

  return `${path}${defaultStringifySearch({ ...search, [name]: wrongValue(parameter.type) })}`
}

/** The router of `of` at `address` over a session holding `roles`, loaded; nothing renders it. */
async function opened(of: readonly ModuleDef[], roles: readonly string[], address: string) {
  const router = createAppRouter({
    modules: of,
    session: holding(roles),
    layout: () => null,
    history: createMemoryHistory({ initialEntries: [address] }),
  })

  await router.load()

  return router
}

/** What the device sees once the router opened `address`, the frame's reading of the screen beside it. */
async function outcomeAt(
  of: readonly ModuleDef[],
  roles: readonly string[],
  address: string,
  binding: Binding,
): Promise<{ readonly outcome: Outcome; readonly screen: string | undefined }> {
  const router = await opened(of, roles, address)
  const { location } = router.state
  const last = router.state.matches.at(-1)
  const screen = resolvedRoute(router.state)

  if (location.href !== address) {
    return { outcome: { kind: 'sent-to', path: location.pathname }, screen }
  }

  if (last?.status === 'notFound') {
    return { outcome: { kind: 'not-found' }, screen }
  }

  if (last?.status === 'error' && last.searchError !== undefined) {
    return { outcome: { kind: 'search-refused' }, screen }
  }

  expect(last?.status, `${address} for ${roles.join('+')}`).toBe('success')
  expect(last?.fullPath, `${address} for ${roles.join('+')}`).toBe(binding.path)

  return { outcome: { kind: 'served' }, screen }
}

/** Every role set at the binding's example and, with a search, at a refused one. */
async function rolesCase(of: readonly ModuleDef[], binding: Binding): Promise<void> {
  const refused = refusedAddress(binding)
  const addresses = [
    [exampleAddress(binding), false] as const,
    ...(refused === undefined ? [] : [[refused, true] as const]),
  ]

  for (const roles of ROLE_SETS) {
    const held = heldRoles(!roles.includes(GUEST), roles)

    for (const [address, isRefused] of addresses) {
      const { outcome, screen } = await outcomeAt(of, roles, address, binding)
      const want = expected(binding, held, isRefused)
      const label = `${address} for ${roles.join('+')}`

      expect(outcome, label).toEqual(want)

      if (want.kind === 'not-found') {
        expect(screen, `the screen the frame reads at ${label}`).toBe(NOT_FOUND_PATH)
      }

      if (want.kind === 'served') {
        expect(screen, `the screen the frame reads at ${label}`).toBe(binding.path)
      }
    }
  }
}

const AT_BASE = bindingsAtBase(ROOT)
const { screens } = loadScreens(ROOT)
const routed = new Set(
  allModules(modules).flatMap((module) => module.routes.map(({ path }) => path)),
)
// The bindings the app routes, each as the contract says it now, or on a branch as it had it at
// the base while its route still equals that one; one not routed yet is routes-contract's.
const bindings: readonly (readonly [string, Binding])[] = heldBindings(
  bindingsOf((screens?.screens ?? []).filter((screen) => screen.frame !== true)),
  allModules(modules).flatMap((module) => module.routes),
  'bindings' in AT_BASE ? AT_BASE.bindings : [],
)
  .filter(({ binding }) => routed.has(binding.path))
  .map(({ binding }) => [binding.path, binding] as const)

describe('the roles of the routed bindings', () => {
  it('cover the bindings of the contract the app routes', () => {
    expect(bindings.length).toBeGreaterThan(0)
  })

  it.each(bindings)('%s serves exactly the roles it names', async (_path, binding) => {
    await rolesCase(modules, binding)
  })
})

const Page = () => null

const PAGE_SEARCH = {
  type: 'object',
  properties: { page: { type: 'integer', minimum: 1, default: 1 } },
  additionalProperties: false,
}

/** Bindings for some roles alone, which no routed screen of the contract has outside the console. */
const LIMITED = [
  bindingSchema.parse({ path: '/limited', roles: ['operator'], search: PAGE_SEARCH }),
  bindingSchema.parse({ path: '/members', roles: ['member', 'admin'] }),
  bindingSchema.parse({ path: '/members-signed-in', guard: 'authenticated', roles: ['admin'] }),
] as const

const SampleModule = defineModule({
  id: 'sample',
  declarations: { Page },
  routes: [
    {
      path: '/limited',
      page: 'Page',
      roles: ['operator'],
      search: z.object({ page: z.int().min(1).default(1) }),
    },
    { path: '/members', page: 'Page', roles: ['member', 'admin'] },
    { path: '/members-signed-in', page: 'Page', guard: 'authenticated', roles: ['admin'] },
    { path: '/$', page: 'Page', roles: [GUEST, IDENTITY, 'member', 'admin'] },
  ],
})

describe('a binding for some roles alone', () => {
  it.each(LIMITED.map((binding) => [binding.path, binding] as const))(
    '%s serves exactly the roles it names, a refused search included',
    async (_path, binding) => {
      await rolesCase([SampleModule], binding)
    },
  )
})
