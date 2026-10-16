// @vitest-environment jsdom
import { createMemoryHistory, Outlet } from '@tanstack/react-router'
import { describe, expect, it } from 'vitest'

import type { AuthUser } from '@workspace/data'

import { defineModule } from './module'
import { createAppRouter } from './router'

const me: AuthUser = {
  id: 'usr_0000000000000000.01m52pexcp' as AuthUser['id'],
  email: 'ann@example.test',
  name: 'Ann',
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

async function landing(path: string, user: AuthUser | undefined): Promise<string> {
  const router = createAppRouter({
    modules: [TestModule],
    session: { current: () => user },
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [path] }),
  })

  await router.load()

  return router.state.location.pathname
}

describe('createAppRouter', () => {
  it('sends a visitor of a protected page to sign-in', async () => {
    expect(await landing('/me', undefined)).toBe('/sign-in')
  })

  it('lets a signed-in user reach a protected page and keeps them away from sign-in', async () => {
    expect(await landing('/me', me)).toBe('/me')
    expect(await landing('/sign-in', me)).toBe('/me')
  })

  it('opens the right start page', async () => {
    expect(await landing('/', undefined)).toBe('/sign-in')
    expect(await landing('/', me)).toBe('/me')
  })
})
