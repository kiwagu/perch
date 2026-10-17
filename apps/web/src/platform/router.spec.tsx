// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { AuthUser } from '@workspace/data'
import { FakeShapeRunner } from '@workspace/data/testing'
import { Container, token } from '@workspace/di'

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
})
