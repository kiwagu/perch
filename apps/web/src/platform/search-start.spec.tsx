// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from './__fixtures__/session'
import { defineModule } from './module'
import { createAppRouter } from './router'
import { useSearchStart } from './search-start'
import { ServicesProvider } from './services'

function Page() {
  return <output data-testid="start">{useSearchStart('email')}</output>
}

const PageModule = defineModule({
  id: 'page',
  declarations: { Page },
  routes: [
    {
      path: '/ask',
      page: 'Page',
      roles: ['guest', 'identity'],
      search: z.object({ email: z.string().optional() }),
    },
  ],
})

function open(at: string) {
  const { session } = fakeSession()
  const router = createAppRouter({
    modules: [PageModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <ServicesProvider services={fakeServices(session)}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )

  return router
}

describe('useSearchStart', () => {
  it('starts with the value the address carries', async () => {
    open('/ask?email=ann%40example.test')

    expect((await screen.findByTestId('start')).textContent).toBe('ann@example.test')
  })

  it('starts empty without one, and keeps its start when the address changes after', async () => {
    const router = open('/ask')

    expect((await screen.findByTestId('start')).textContent).toBe('')

    await act(() => router.navigate({ to: '/ask', search: { email: 'bob@example.test' } }))

    expect(screen.getByTestId('start').textContent).toBe('')
  })
})
