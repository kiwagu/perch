// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider, useSearch } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from './__fixtures__/session'
import { defineModule } from './module'
import { type PageMoves, usePageMoves } from './page-moves'
import { createAppRouter } from './router'
import { ServicesProvider } from './services'

const search = z.object({
  q: z.string().optional(),
  page: z.int().min(1).default(1),
  size: z.literal([10, 25, 50]).default(25),
})

/** What the page's parts move with, as the last render gave them. */
const held: { moves?: PageMoves } = {}

function Page() {
  held.moves = usePageMoves(z.parse(search, useSearch({ strict: false })), 25)

  return <output data-testid="page">paged</output>
}

const PageModule = defineModule({
  id: 'page',
  declarations: { Page },
  routes: [
    {
      path: '/things',
      page: 'Page',
      roles: ['guest', 'identity'],
      retain: ['size'],
      search,
    },
  ],
})

async function open(at: string) {
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
  await screen.findByTestId('page')

  return { router, moves: () => held.moves ?? expect.unreachable('the page rendered') }
}

const address = (router: Awaited<ReturnType<typeof open>>['router']): string =>
  `${router.state.location.pathname}${router.state.location.searchStr}`

describe('usePageMoves', () => {
  it('moves to another page of the same search and size, at the address its link carries', async () => {
    const { router, moves } = await open('/things?q=%22ann%22&size=10')
    const href = moves().pageHref(2)

    await act(async () => moves().toPage(2))

    expect(router.state.location.search).toEqual({ q: 'ann', page: 2, size: 10 })
    expect(address(router)).toBe(href)

    await act(async () => moves().toPage(1))

    expect(router.state.location.search).toEqual({ q: 'ann', size: 10 })
  })

  it('starts the first page of the size chosen, the default one leaving the address though another was retained', async () => {
    const { router, moves } = await open('/things?q=%22ann%22&page=3')

    await act(async () => moves().toSize(10))

    expect(router.state.location.search).toEqual({ q: 'ann', size: 10 })

    await act(async () => moves().toSize(25))

    expect(router.state.location.search).toEqual({ q: 'ann' })

    await act(() => router.navigate({ to: '/things', search: { q: 'bob', page: 1 } }))

    expect(address(router)).toBe('/things?q=bob')
  })
})
