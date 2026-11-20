// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from './__fixtures__/session'
import { defineModule } from './module'
import { createAppRouter } from './router'
import { useSearchValue } from './search-value'
import { ServicesProvider } from './services'

function Page() {
  const [value, setValue] = useSearchValue('q')

  return (
    <input
      aria-label="Search"
      data-testid="field"
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  )
}

const PageModule = defineModule({
  id: 'page',
  declarations: { Page },
  routes: [
    {
      path: '/find',
      page: 'Page',
      roles: ['guest', 'identity'],
      search: z.object({ q: z.string().optional(), page: z.int().min(1).default(1) }),
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

const field = async (): Promise<HTMLInputElement> => {
  const found = await screen.findByTestId('field')

  return found instanceof HTMLInputElement ? found : expect.unreachable('an input')
}

describe('useSearchValue', () => {
  it('starts with the value the address carries, empty without one, and holds what is typed', async () => {
    open('/find?q=ann')

    expect((await field()).value).toBe('ann')

    fireEvent.change(await field(), { target: { value: 'anna' } })

    expect((await field()).value).toBe('anna')
  })

  it("takes the address's value again when the route's search changes: a new search, then Back", async () => {
    const router = open('/find?q=ann')

    fireEvent.change(await field(), { target: { value: 'typed' } })

    await act(() => router.navigate({ to: '/find', search: { q: 'bob' } }))

    expect((await field()).value).toBe('bob')

    fireEvent.change(await field(), { target: { value: 'typed again' } })

    await act(async () => {
      router.history.back()
      await router.load()
    })

    expect((await field()).value).toBe('ann')
  })

  it('drops what was typed for good once the search changed, though Back returns to it', async () => {
    const router = open('/find?q=ann')

    fireEvent.change(await field(), { target: { value: 'typed' } })

    await act(() => router.navigate({ to: '/find', search: { q: 'bob' } }))
    await act(async () => {
      router.history.back()
      await router.load()
    })

    expect((await field()).value).toBe('ann')
  })

  it('takes the address again when another search value changes, the text there the same', async () => {
    const router = open('/find')

    expect((await field()).value).toBe('')

    fireEvent.change(await field(), { target: { value: 'typed' } })

    await act(() => router.navigate({ to: '/find', search: { page: 2 } }))

    expect((await field()).value).toBe('')
  })
})
