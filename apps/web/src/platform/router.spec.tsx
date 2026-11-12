// @vitest-environment jsdom
import {
  createMemoryHistory,
  Outlet,
  RouterProvider,
  SearchParamError,
} from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container, token } from '@workspace/di'
import type { PlatformRole, TenantRole } from '@workspace/kernel'
import type { Membership } from '@workspace/replica/protocol'
import { z } from '@workspace/zod'

import { defineModule, useService } from './module'
import { createAppRouter, type RouterSession } from './router'
import { ServicesProvider } from './services'

const me: AuthUser = {
  id: 'idn_0000000000000000.01m52pexcp' as AuthUser['id'],
  email: 'ann@example.test',
}

/** The roles of a page anyone opens, a guest or any signed-in account. */
const ANYONE = ['guest', 'identity']

const Page = () => null

const TestModule = defineModule({
  id: 'test',
  declarations: { Page },
  routes: [
    { path: '/sign-in', page: 'Page', guard: 'guest', roles: ['guest'] },
    { path: '/verify-email', page: 'Page', guard: 'guest', roles: ['guest'] },
    { path: '/forgot-password', page: 'Page', guard: 'guest', roles: ['guest'] },
    { path: '/me', page: 'Page', guard: 'authenticated', roles: ['identity'] },
  ],
})

const NO_ROLES: ReadonlySet<PlatformRole> = new Set()

/** A session that only says who is signed in, as long as nobody signs in or out; no roles beside. */
const fixed = (user: AuthUser | undefined): RouterSession => ({
  current: () => user,
  subscribe: () => () => {},
  signingInHere: () => false,
  currentTenant: () => undefined,
  subscribeMemberships: () => () => {},
  roles: () => NO_ROLES,
  onRoles: () => () => {},
})

/** The organisation Ann belongs to in these tests, with her role there. */
const acme = (role: TenantRole): Membership => ({
  tenant: { id: 'tnt_acme', key: 'acme', name: 'Acme' },
  role,
})

/**
 * A session whose account the test changes, as this tab or another one would: `signIn` tells of
 * the account, as a sign-in of this tab's own while `here` says so, with the roles and the
 * organisation it reads then; `grant` tells of the account's platform roles read anew (a welcome,
 * another tab's), and `join` of its role in the organisation current.
 */
function switching(start: AuthUser | undefined, roles: readonly PlatformRole[] = []) {
  let user = start
  let here = false
  let platform: ReadonlySet<PlatformRole> = new Set(roles)
  let tenant: Membership | undefined
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const roleListeners = new Set<(next: ReadonlySet<PlatformRole>) => void>()
  const membershipListeners = new Set<() => void>()
  const tell = (next: AuthUser | undefined) => {
    user = next

    for (const listener of listeners) {
      listener(next)
    }
  }
  const grant = (next: readonly PlatformRole[]) => {
    platform = new Set(next)

    for (const listener of roleListeners) {
      listener(platform)
    }
  }
  const join = (role: TenantRole | undefined) => {
    tenant = role === undefined ? undefined : acme(role)

    for (const listener of membershipListeners) {
      listener()
    }
  }

  return {
    session: {
      current: () => user,
      subscribe: (listener: (next: AuthUser | undefined) => void) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
      signingInHere: () => here,
      currentTenant: () => tenant,
      subscribeMemberships: (listener: () => void) => {
        membershipListeners.add(listener)

        return () => {
          membershipListeners.delete(listener)
        }
      },
      roles: () => platform,
      onRoles: (listener: (next: ReadonlySet<PlatformRole>) => void) => {
        roleListeners.add(listener)

        return () => {
          roleListeners.delete(listener)
        }
      },
    } satisfies RouterSession,
    signIn: (
      next: AuthUser,
      own = false,
      reads: { readonly roles?: readonly PlatformRole[]; readonly tenant?: TenantRole } = {},
    ) => {
      here = own
      tell(next)
      grant(reads.roles ?? [])
      join(reads.tenant)
      here = false
    },
    signOut: () => tell(undefined),
    grant,
    join,
  }
}

/** The router of the test module at `path`, over `session`, loaded. */
async function loaded(path: string, session: ReturnType<typeof switching>['session']) {
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()

  return router
}

async function landing(path: string, user: AuthUser | undefined): Promise<string> {
  const router = createAppRouter({
    modules: [TestModule],
    session: fixed(user),
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()

  return router.state.location.pathname
}

const GREETING = token<string>('Greeting')

const Greeting = () => <p>{useService(GREETING)}</p>

const GreetingModule = defineModule({
  id: 'greeting',
  providers: [{ provide: GREETING, useFactory: () => 'provided by the module' }],
  declarations: { Greeting },
  routes: [{ path: '/hello', page: 'Greeting', roles: ANYONE }],
})

const Tab = () => <p>the tab page</p>

const tabSearch = z.object({ tab: z.enum(['a', 'b']).default('a') })

const TabModule = defineModule({
  id: 'tab',
  declarations: { Tab },
  routes: [
    { path: '/x', page: 'Tab', roles: ANYONE, search: tabSearch },
    { path: '/y', page: 'Tab', roles: ANYONE, search: tabSearch, retain: ['tab'] },
    { path: '/z', page: 'Tab', roles: ANYONE, search: tabSearch },
  ],
})

/** The router of the tab module, rendered at `path`, so the router settles its URL. */
function renderedAt(path: string) {
  const router = createAppRouter({
    modules: [TabModule],
    session: fixed(undefined),
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  render(
    <ServicesProvider services={{ container: new Container(), runner: new FakeShapeRunner() }}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )

  return router
}

describe('createAppRouter', () => {
  it("renders a page inside its module's scope", async () => {
    const router = createAppRouter({
      modules: [GreetingModule],
      session: fixed(undefined),
      layout: () => <Outlet />,
      history: createMemoryHistory({ initialEntries: ['/hello'] }),
    })

    render(
      <ServicesProvider services={{ container: new Container(), runner: new FakeShapeRunner() }}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    )

    expect(await screen.findByText('provided by the module')).toBeTruthy()
  })

  it('sends a visitor of a protected page to sign-in', async () => {
    expect(await landing('/me', undefined)).toBe('/sign-in')
  })

  it('lets a signed-in user reach a protected page and keeps them away from sign-in', async () => {
    expect(await landing('/me', me)).toBe('/me')
    expect(await landing('/sign-in', me)).toBe('/me')
  })

  it('sends an open protected page to sign-in once the user signs out', async () => {
    const { session, signOut } = switching(me)
    const router = await loaded('/me', session)

    expect(router.state.location.pathname).toBe('/me')

    signOut()

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
  })

  it('sends an open guest page to the profile once another tab signs the browser in', async () => {
    const { session, signIn } = switching(undefined)
    const router = await loaded('/sign-in', session)

    signIn(me)

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it('leaves a guest page where it is while this tab signs in itself: its flow moves on', async () => {
    const { session, signIn } = switching(undefined)
    const router = await loaded('/sign-in', session)

    signIn(me, true)
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('leaves it there too when the sign-in of its own reads roles and an organisation', async () => {
    const { session, signIn } = switching(undefined)
    const router = await loaded('/sign-in', session)

    signIn(me, true, { roles: ['operator'], tenant: 'admin' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it("leaves a verification link's page where it is too while its exchange signs this tab in", async () => {
    const { session, signIn } = switching(undefined)
    const router = await loaded('/verify-email', session)

    signIn(me, true, { roles: ['operator'], tenant: 'admin' })
    await new Promise((resolve) => setTimeout(resolve, 20))

    expect(router.state.location.pathname).toBe('/verify-email')
  })

  it('sends any other guest page open meanwhile to the profile: only the page that signs in has a flow to follow', async () => {
    const { session, signIn } = switching(undefined)
    const router = await loaded('/forgot-password', session)

    signIn(me, true)

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/me'))
  })

  it('opens the right start page', async () => {
    expect(await landing('/', undefined)).toBe('/sign-in')
    expect(await landing('/', me)).toBe('/me')
  })

  describe('with the search schema of a route', () => {
    it('takes a search the schema accepts', async () => {
      const router = renderedAt('/x?tab=b')

      expect(await screen.findByText('the tab page')).toBeTruthy()
      expect(router.state.location.href).toBe('/x?tab=b')
      expect(router.state.location.search).toEqual({ tab: 'b' })
    })

    it('sends a search the schema refuses to the error component', async () => {
      const router = renderedAt('/x?tab=zzz')

      await vi.waitFor(() => expect(router.state.matches.at(-1)?.status).toBe('error'))
      expect(router.state.matches.at(-1)?.error).toBeInstanceOf(SearchParamError)
      expect(screen.queryByText('the tab page')).toBeNull()
    })

    it('strips a parameter that equals its default from the URL', async () => {
      const router = renderedAt('/x?tab=a')

      expect(await screen.findByText('the tab page')).toBeTruthy()
      await vi.waitFor(() => expect(router.state.location.href).toBe('/x'))
      expect(router.state.location.search).toEqual({})
    })

    it('carries a retained parameter to the next page, and only a retained one', async () => {
      const router = renderedAt('/x?tab=b')

      expect(await screen.findByText('the tab page')).toBeTruthy()
      await router.navigate({ to: '/y' })
      expect(router.state.location.href).toBe('/y?tab=b')
      await router.navigate({ to: '/z' })
      expect(router.state.location.href).toBe('/z')
    })
  })
})

/** A page that fails to render while `failing` says so. */
const crashing = { failing: true }

const Fragile = () => {
  if (crashing.failing) {
    throw new Error('the page broke')
  }

  return <p>the page renders</p>
}

const FragileModule = defineModule({
  id: 'fragile',
  declarations: { Fragile },
  routes: [{ path: '/fragile', page: 'Fragile', roles: ANYONE }],
})

describe('a page that fails to render', () => {
  it('gets the crash in its place, the layout around it, and renders again on reset', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const router = createAppRouter({
      modules: [FragileModule],
      session: fixed(undefined),
      layout: () => (
        <main>
          <p>the frame</p>
          <Outlet />
        </main>
      ),
      history: createMemoryHistory({ initialEntries: ['/fragile'] }),
      crash: ({ error, reset }) => (
        <button type="button" onClick={reset}>
          {`crashed: ${error instanceof Error ? error.message : String(error)}`}
        </button>
      ),
    })

    crashing.failing = true
    render(
      <ServicesProvider services={{ container: new Container(), runner: new FakeShapeRunner() }}>
        <RouterProvider router={router} />
      </ServicesProvider>,
    )

    const crash = await screen.findByText('crashed: the page broke')

    expect(screen.getByText('the frame')).toBeTruthy()
    expect(screen.queryByText('the page renders')).toBeNull()

    crashing.failing = false
    fireEvent.click(crash)

    expect(await screen.findByText('the page renders')).toBeTruthy()
    expect(screen.queryByText('crashed: the page broke')).toBeNull()
    quiet.mockRestore()
  })
})

/** How often the operator's page rendered: a device its roles refuse never renders it. */
const renders = { limited: 0 }

const Limited = () => {
  renders.limited += 1

  return <p>the operator's page</p>
}

const Members = () => <p>the members' page</p>

const Lost = () => <p>no page here</p>

/** Pages for some roles alone, and the not-found page every account opens. */
const LimitedModule = defineModule({
  id: 'limited',
  declarations: { Limited, Members, Lost },
  routes: [
    {
      path: '/limited',
      page: 'Limited',
      roles: ['operator'],
      search: z.object({ page: z.int().min(1).default(1) }),
    },
    { path: '/members', page: 'Members', roles: ['member', 'admin'] },
    { path: '/$', page: 'Lost', roles: ['guest', 'identity', 'member', 'admin'] },
  ],
})

/**
 * The router of the limited pages over `session`, rendered at `path` with a frame around, which
 * says a page that failed, its search refused included, in the page's place.
 */
function limitedAt(path: string, session: RouterSession) {
  const router = createAppRouter({
    modules: [LimitedModule],
    session,
    layout: () => (
      <main>
        <p>the frame</p>
        <Outlet />
      </main>
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
    crash: () => <p>the page failed</p>,
  })

  render(
    <ServicesProvider services={{ container: new Container(), runner: new FakeShapeRunner() }}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )

  return router
}

/** The page the test expects open, by its text: `the page failed` for a search refused. */
type Shown = "the operator's page" | "the members' page" | 'no page here' | 'the page failed'

/** The open page shows `shown` at `href`, the frame around it, and no other page. */
async function showing(router: ReturnType<typeof limitedAt>, href: string, shown: Shown) {
  expect(await screen.findByText(shown)).toBeTruthy()

  if (shown === 'the page failed') {
    expect(router.state.matches.at(-1)?.error).toBeInstanceOf(SearchParamError)
  }

  const pages: readonly Shown[] = [
    "the operator's page",
    "the members' page",
    'no page here',
    'the page failed',
  ]

  for (const other of pages.filter((page) => page !== shown)) {
    expect(screen.queryByText(other), `${other} at ${href}`).toBeNull()
  }

  expect(screen.getByText('the frame')).toBeTruthy()
  expect(router.state.location.href).toBe(href)
}

describe('a page for some roles alone', () => {
  it('opens for its roles, and for any other account shows the not-found page at the same address, never rendering', async () => {
    renders.limited = 0
    const guest = limitedAt('/limited?page=2', fixed(undefined))

    await showing(guest, '/limited?page=2', 'no page here')
    expect(guest.state.matches.at(-1)?.status).toBe('notFound')
    cleanup()

    const signedIn = limitedAt('/limited?page=2', fixed(me))

    await showing(signedIn, '/limited?page=2', 'no page here')
    expect(renders.limited).toBe(0)
    cleanup()

    const { session } = switching(me, ['operator'])

    await showing(limitedAt('/limited?page=2', session), '/limited?page=2', "the operator's page")
  })

  it('decides before its search is read: a refused account gets the not-found page, not the search error', async () => {
    renders.limited = 0
    const router = limitedAt('/limited?page=0', fixed(me))

    await showing(router, '/limited?page=0', 'no page here')
    expect(router.state.matches.at(-1)?.status).toBe('notFound')
    expect(router.state.matches.at(-1)?.searchError).toBeUndefined()
    expect(renders.limited).toBe(0)
  })

  it('checks the open page again when its roles are granted, revoked and granted again', async () => {
    const { session, grant } = switching(me)
    const router = limitedAt('/limited?page=2', session)

    await showing(router, '/limited?page=2', 'no page here')

    act(() => grant(['operator']))
    await showing(router, '/limited?page=2', "the operator's page")

    renders.limited = 0
    act(() => grant([]))
    await showing(router, '/limited?page=2', 'no page here')
    expect(router.state.matches.at(-1)?.status).toBe('notFound')
    expect(renders.limited).toBe(0)

    act(() => grant(['operator']))
    await showing(router, '/limited?page=2', "the operator's page")
  })

  it('checks it again at a search it refuses: the search error for its roles, the not-found page for the others', async () => {
    const { session, grant } = switching(me)
    const router = limitedAt('/limited?page=0', session)

    await showing(router, '/limited?page=0', 'no page here')

    act(() => grant(['operator']))
    await showing(router, '/limited?page=0', 'the page failed')

    act(() => grant([]))
    await showing(router, '/limited?page=0', 'no page here')
    expect(router.state.matches.at(-1)?.searchError).toBeUndefined()

    act(() => grant(['operator']))
    await showing(router, '/limited?page=0', 'the page failed')
  })

  it("checks it again when the account's role in the organisation current changes", async () => {
    const { session, join } = switching(me)
    const router = limitedAt('/members', session)

    await showing(router, '/members', 'no page here')

    act(() => join('member'))
    await showing(router, '/members', "the members' page")

    act(() => join(undefined))
    await showing(router, '/members', 'no page here')
  })

  it("checks it again when a sign-in of this tab's own brings its roles, no other page's flow to follow", async () => {
    const { session, signIn } = switching(undefined)
    const router = limitedAt('/limited?page=2', session)

    await showing(router, '/limited?page=2', 'no page here')

    act(() => signIn(me, true, { roles: ['operator'] }))
    await showing(router, '/limited?page=2', "the operator's page")
  })

  it("checks it again at a search it refuses when a sign-in of this tab's own brings its roles: the search error", async () => {
    const { session, signIn } = switching(undefined)
    const router = limitedAt('/limited?page=0', session)

    await showing(router, '/limited?page=0', 'no page here')

    act(() => signIn(me, true, { roles: ['operator'] }))
    await showing(router, '/limited?page=0', 'the page failed')
  })

  it('shows the not-found page at the address once the account signs out', async () => {
    const { session, signOut } = switching(me, ['operator'])
    const router = limitedAt('/limited?page=2', session)

    await showing(router, '/limited?page=2', "the operator's page")

    act(() => signOut())
    await showing(router, '/limited?page=2', 'no page here')
  })
})
