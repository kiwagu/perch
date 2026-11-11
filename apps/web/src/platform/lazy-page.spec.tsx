// @vitest-environment jsdom
/**
 * A page whose code loads on demand (`LazyPage`): the router loads it once the page's route
 * admits the device, after its guard and roles, never for a device it refuses; the frame stays
 * while it loads, the page's place empty; the code loads once; and code that did not arrive loads
 * again when the page opens anew or the crash in its place renders it again.
 */

import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { type FunctionComponent, useEffect } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { FakeShapeRunner } from '@workspace/data/testing'
import { Container, token } from '@workspace/di'
import type { PlatformRole } from '@workspace/kernel'
import { GUEST, IDENTITY } from '@workspace/ui-contract/anchors'

import { holding } from './__fixtures__/router'
import { defineModule, useService } from './module'
import { createAppRouter, type RouterSession } from './router'
import { ServicesProvider } from './services'

const WORDS = token<string>('words')

/** How often the operator's page was mounted. */
const mounts = { operator: 0 }

/** The operator's page, its words from its module's scope. */
const Operator = () => {
  useEffect(() => {
    mounts.operator += 1
  }, [])

  return <p>{useService(WORDS)}</p>
}

const Lost = () => <p>no page here</p>

const Home = () => <p>the home page</p>

/** The load of the operator's page's code: what the router asks for, and when. */
const load = vi.fn((): Promise<FunctionComponent> => Promise.resolve(Operator))

/** A page for the operator alone whose code loads on demand, beside pages every device opens. */
const LazyModule = defineModule({
  id: 'lazy',
  providers: [{ provide: WORDS, useFactory: () => "the operator's page" }],
  declarations: { Operator: { load: () => load() }, Home, Lost },
  routes: [
    { path: '/console', page: 'Operator', roles: ['operator'] },
    { path: '/home', page: 'Home', roles: [GUEST, IDENTITY] },
    { path: '/$', page: 'Lost', roles: [GUEST, IDENTITY] },
  ],
})

/** A signed-in session whose platform roles the test grants, as a read of them anew would. */
function granting(start: readonly PlatformRole[]) {
  let platform: ReadonlySet<PlatformRole> = new Set(start)
  const listeners = new Set<(roles: ReadonlySet<PlatformRole>) => void>()
  const session: RouterSession = {
    ...holding([IDENTITY]),
    roles: () => platform,
    onRoles: (listener) => {
      listeners.add(listener)

      return () => {
        listeners.delete(listener)
      }
    },
  }
  const grant = (roles: readonly PlatformRole[]) => {
    platform = new Set(roles)

    for (const listener of listeners) {
      listener(platform)
    }
  }

  return { session, grant }
}

/** The router of the lazy module over `session` at `path`, rendered inside a frame. */
function openAt(path: string, session: RouterSession) {
  const router = createAppRouter({
    modules: [LazyModule],
    session,
    layout: () => (
      <main>
        <p>the frame</p>
        <Outlet />
      </main>
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
    // The frame's crash, whose button renders the page again.
    crash: ({ reset }) => (
      <button type="button" onClick={reset}>
        the page failed
      </button>
    ),
  })

  render(
    <ServicesProvider services={{ container: new Container(), runner: new FakeShapeRunner() }}>
      <RouterProvider router={router} />
    </ServicesProvider>,
  )

  return router
}

/** A load of the page's code held until the test lets it arrive. */
function heldLoad() {
  let arrive: (page: FunctionComponent) => void = () => undefined

  load.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        arrive = resolve
      }),
  )

  return { arrive: () => arrive(Operator) }
}

beforeEach(() => {
  cleanup()
  load.mockClear()
  mounts.operator = 0
})

describe('a page whose code loads on demand', () => {
  it('never loads its code for a device its roles refuse: a guest and an account without the role get the not-found page', async () => {
    openAt('/console', holding([GUEST]))
    expect(await screen.findByText('no page here')).toBeTruthy()
    cleanup()

    openAt('/console', holding([IDENTITY, 'admin']))
    expect(await screen.findByText('no page here')).toBeTruthy()
    expect(load).not.toHaveBeenCalled()
  })

  it("loads its code once its roles admit the device, and renders it in its module's scope", async () => {
    openAt('/console', holding([IDENTITY, 'operator']))

    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(screen.getByText('the frame')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('loads its code when a role granted where it is opens the page, and not before', async () => {
    const { session, grant } = granting([])

    openAt('/console', session)
    expect(await screen.findByText('no page here')).toBeTruthy()
    expect(load).not.toHaveBeenCalled()

    act(() => grant(['operator']))

    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('shows the frame at once while its code loads, its place empty, and the page once the code is in', async () => {
    const code = heldLoad()

    openAt('/console', holding([IDENTITY, 'operator']))

    expect(await screen.findByText('the frame')).toBeTruthy()
    expect(screen.getByRole('main').textContent).toBe('the frame')
    expect(load).toHaveBeenCalledTimes(1)

    act(() => code.arrive())

    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(screen.getByText('the frame')).toBeTruthy()
  })

  it('opened from another page, leaves its place empty in the frame while its code loads', async () => {
    const code = heldLoad()
    const router = openAt('/home', holding([IDENTITY, 'operator']))

    expect(await screen.findByText('the home page')).toBeTruthy()

    const moving = router.navigate({ to: '/console' })

    await vi.waitFor(() => expect(screen.getByRole('main').textContent).toBe('the frame'))
    expect(load).toHaveBeenCalledTimes(1)

    await act(async () => {
      code.arrive()
      await moving
    })

    expect(await screen.findByText("the operator's page")).toBeTruthy()
  })

  it('loads its code once, however often the page opens', async () => {
    const router = openAt('/console', holding([IDENTITY, 'operator']))

    expect(await screen.findByText("the operator's page")).toBeTruthy()

    await act(() => router.navigate({ to: '/home' }))
    expect(await screen.findByText('the home page')).toBeTruthy()

    await act(() => router.navigate({ to: '/console' }))
    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('stays as it is when the open page is checked again', async () => {
    const router = openAt('/console', holding([IDENTITY, 'operator']))

    expect(await screen.findByText("the operator's page")).toBeTruthy()

    // What a change of the roles held does: the open page is checked again where it is.
    await act(() => router.invalidate())

    expect(screen.getByText("the operator's page")).toBeTruthy()
    expect(mounts.operator).toBe(1)
    expect(load).toHaveBeenCalledTimes(1)
  })

  it("fails into the frame's crash when its code does not arrive, and loads it again when the page opens anew", async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    load.mockImplementationOnce(() => Promise.reject(new Error('the code did not arrive')))
    const router = openAt('/console', holding([IDENTITY, 'operator']))

    expect(await screen.findByText('the page failed')).toBeTruthy()

    await act(() => router.navigate({ to: '/home' }))
    await act(() => router.navigate({ to: '/console' }))

    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    quiet.mockRestore()
  })

  it('loads its code again and renders when the crash its failed code left asks to render it again', async () => {
    const quiet = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

    load.mockImplementationOnce(() => Promise.reject(new Error('the code did not arrive')))
    openAt('/console', holding([IDENTITY, 'operator']))

    fireEvent.click(await screen.findByText('the page failed'))

    expect(await screen.findByText("the operator's page")).toBeTruthy()
    expect(screen.queryByText('the page failed')).toBeNull()
    expect(screen.getByText('the frame')).toBeTruthy()
    expect(load).toHaveBeenCalledTimes(2)
    quiet.mockRestore()
  })
})
