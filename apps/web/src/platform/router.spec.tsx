// @vitest-environment jsdom
import {
  createMemoryHistory,
  Outlet,
  RouterProvider,
  SearchParamError,
} from '@tanstack/react-router'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container, token } from '@workspace/di'
import { z } from '@workspace/zod'

import { defineModule, useService } from './module'
import { createAppRouter } from './router'
import { ServicesProvider } from './services'

const me: AuthUser = {
  id: 'idn_0000000000000000.01m52pexcp' as AuthUser['id'],
  email: 'ann@example.test',
}

const Page = () => null

const TestModule = defineModule({
  id: 'test',
  declarations: { Page },
  routes: [
    { path: '/sign-in', page: 'Page', guard: 'guest' },
    { path: '/me', page: 'Page', guard: 'authenticated' },
  ],
})

/** A session that only says who is signed in, as long as nobody signs in or out. */
const fixed = (user: AuthUser | undefined) => ({ current: () => user, subscribe: () => () => {} })

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
  routes: [{ path: '/hello', page: 'Greeting' }],
})

const Tab = () => <p>the tab page</p>

const tabSearch = z.object({ tab: z.enum(['a', 'b']).default('a') })

const TabModule = defineModule({
  id: 'tab',
  declarations: { Tab },
  routes: [
    { path: '/x', page: 'Tab', search: tabSearch },
    { path: '/y', page: 'Tab', search: tabSearch, retain: ['tab'] },
    { path: '/z', page: 'Tab', search: tabSearch },
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
    let user: AuthUser | undefined = me
    const listeners = new Set<(next: AuthUser | undefined) => void>()
    const router = createAppRouter({
      modules: [TestModule],
      session: {
        current: () => user,
        subscribe: (listener) => {
          listeners.add(listener)

          return () => listeners.delete(listener)
        },
      },
      layout: () => <Outlet />,
      history: createMemoryHistory({ initialEntries: ['/me'] }),
    })

    await router.load()
    expect(router.state.location.pathname).toBe('/me')

    user = undefined

    for (const listener of listeners) {
      listener(undefined)
    }

    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/sign-in'))
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
  routes: [{ path: '/fragile', page: 'Fragile' }],
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
