// @vitest-environment jsdom
import {
  createBrowserHistory,
  createMemoryHistory,
  Link,
  Outlet,
  type RouterHistory,
  RouterProvider,
} from '@tanstack/react-router'
import { act, cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { Input } from '@workspace/ui/components/ui/input'
import { UnsavedInputScope } from '@workspace/ui/unsaved-input'
import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { useLeaveGuard } from '../../../../platform/leave-guard.port'
import { defineModule } from '../../../../platform/module'
import { NoticeProvider } from '../../../../platform/notices'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'

import { LeaveGuard } from './leave-guard.container'

const DIALOG = '[data-testid="app-shell.leave-dialog"][data-code="unsaved-input"]'

/** Asks the frame before a control, and shows the answer. */
function Asking(props: { readonly control: string }) {
  const guard = useLeaveGuard()
  const [answer, setAnswer] = useState('none')

  return (
    <button
      type="button"
      onClick={() => void guard.before(props.control).then((leave) => setAnswer(String(leave)))}
    >
      {`${props.control}: ${answer}`}
    </button>
  )
}

function One() {
  return (
    <>
      <Input aria-label="name" defaultValue="" />
      <Link to="/two">to two</Link>
      <Link to="/one" search={{ tab: 'b' }}>
        to tab b
      </Link>
      <Asking control="app-shell.locale-select" />
      <Asking control="x.other-button" />
    </>
  )
}

const Pages = defineModule({
  id: 'pages',
  declarations: { One, Two: () => <p>two</p> },
  routes: [
    { path: '/one', page: 'One', search: z.object({ tab: z.enum(['a', 'b']).default('a') }) },
    { path: '/two', page: 'Two' },
  ],
})

function Layout() {
  return (
    <NoticeProvider>
      <UnsavedInputScope>
        <LeaveGuard>
          <Outlet />
        </LeaveGuard>
      </UnsavedInputScope>
    </NoticeProvider>
  )
}

async function open(history: RouterHistory = createMemoryHistory({ initialEntries: ['/one'] })) {
  const { session } = fakeSession()
  const router = createAppRouter({ modules: [Pages], session, layout: Layout, history })

  render(
    <I18nProvider locale="en" catalogs={{ en, es }}>
      <ServicesProvider services={fakeServices(session)}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )
  await screen.findByLabelText('name')

  return router
}

const dialog = () => document.querySelector(DIALOG)

afterEach(() => cleanup())

describe('LeaveGuard', () => {
  it('asks before another screen while a field holds unsaved input: Stay keeps it, Leave goes', async () => {
    const user = userEvent.setup()
    const router = await open()

    await user.type(screen.getByLabelText('name'), 'Ann')
    await user.click(screen.getByText('to two'))
    expect(await screen.findByTestId('app-shell.leave-dialog')).toBe(dialog())

    await user.click(screen.getByTestId('app-shell.leave-dialog.cancel-button'))
    expect(router.state.location.pathname).toBe('/one')
    expect(screen.getByLabelText('name')).toHaveProperty('value', 'Ann')
    expect(dialog()).toBeNull()

    await user.click(screen.getByText('to two'))
    await user.click(await screen.findByTestId('app-shell.leave-dialog.confirm-button'))
    expect(await screen.findByText('two')).toBeDefined()
    expect(router.state.location.pathname).toBe('/two')
  })

  it('moves at once while nothing is typed', async () => {
    const user = userEvent.setup()
    const router = await open()

    await user.click(screen.getByText('to two'))

    expect(await screen.findByText('two')).toBeDefined()
    expect(router.state.location.pathname).toBe('/two')
    expect(dialog()).toBeNull()
  })

  it('never asks for a change of state inside one screen', async () => {
    const user = userEvent.setup()
    const router = await open()

    await user.type(screen.getByLabelText('name'), 'Ann')
    await user.click(screen.getByText('to tab b'))

    expect(router.state.location.search).toEqual({ tab: 'b' })
    expect(dialog()).toBeNull()
    expect(screen.getByLabelText('name')).toHaveProperty('value', 'Ann')
  })

  it('lets the browser ask before a reload while a field holds unsaved input, and only then', async () => {
    const user = userEvent.setup()

    window.history.replaceState(null, '', '/one')
    await open(createBrowserHistory())

    const unload = () => window.dispatchEvent(new Event('beforeunload', { cancelable: true }))

    expect(unload()).toBe(true)
    await user.type(screen.getByLabelText('name'), 'A')
    expect(unload()).toBe(false)
    await user.type(screen.getByLabelText('name'), '{backspace}')
    expect(unload()).toBe(true)
  })

  it('asks before a leaving control while a field holds unsaved input, and not before another', async () => {
    const user = userEvent.setup()

    await open()
    await user.click(screen.getByText('x.other-button: none'))
    expect(await screen.findByText('x.other-button: true')).toBeDefined()

    await user.type(screen.getByLabelText('name'), 'Ann')
    await user.click(screen.getByText('app-shell.locale-select: none'))
    await user.click(await screen.findByTestId('app-shell.leave-dialog.cancel-button'))
    expect(await screen.findByText('app-shell.locale-select: false')).toBeDefined()

    await user.click(screen.getByText('app-shell.locale-select: false'))
    await user.click(await screen.findByTestId('app-shell.leave-dialog.confirm-button'))
    expect(await screen.findByText('app-shell.locale-select: true')).toBeDefined()

    await user.click(screen.getByText('x.other-button: true'))
    expect(dialog()).toBeNull()
    await act(() => Promise.resolve())
  })
})
