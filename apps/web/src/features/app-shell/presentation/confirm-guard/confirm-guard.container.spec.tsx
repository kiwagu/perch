// @vitest-environment jsdom
import { createMemoryHistory, Link, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'

import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import { useConfirmGuard } from '../../../../platform/confirm-guard.port'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { defineModule } from '../../../../platform/module'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'

import { ConfirmGuard } from './confirm-guard.container'

const DIALOG = 'app-shell.confirmation'

/** Every answer given, as `<control>: <go>`, kept past the page that asked. */
const answers: string[] = []

/** Asks the frame before a control, and shows the answer. */
function Asking(props: { readonly control: string }) {
  const guard = useConfirmGuard()
  const [answer, setAnswer] = useState('none')

  return (
    <button
      type="button"
      onClick={() =>
        void guard.before(props.control).then((go) => {
          answers.push(`${props.control}: ${String(go)}`)
          setAnswer(String(go))
        })
      }
    >
      {`${props.control}: ${answer}`}
    </button>
  )
}

function One() {
  return (
    <>
      <Link to="/two">to two</Link>
      <Asking control="organisation.notes.delete-button" />
      <Asking control="device.list.revoke-button" />
      <Asking control="x.other-button" />
    </>
  )
}

const Pages = defineModule({
  id: 'pages',
  declarations: { One, Two: () => <p>two</p> },
  routes: [
    { path: '/one', page: 'One' },
    { path: '/two', page: 'Two' },
  ],
})

function Layout() {
  return (
    <ConfirmGuard>
      <Outlet />
    </ConfirmGuard>
  )
}

async function open() {
  const { session } = fakeSession()
  const router = createAppRouter({
    modules: [Pages],
    session,
    layout: Layout,
    history: createMemoryHistory({ initialEntries: ['/one'] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en, es }}>
      <ServicesProvider services={fakeServices(session)}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )
  await screen.findByText('to two')

  return router
}

const dialog = (code: string) =>
  document.querySelector(`[data-testid="${DIALOG}"][data-code="${code}"]`)

afterEach(() => {
  cleanup()
  answers.length = 0
})

describe('ConfirmGuard', () => {
  it('asks before a destructive action with its code and words: cancel stays, confirm goes on', async () => {
    const user = userEvent.setup()

    await open()
    await user.click(screen.getByText('organisation.notes.delete-button: none'))
    expect(await screen.findByText('Delete this note?')).toBeDefined()
    expect(dialog('note-delete')).not.toBeNull()

    await user.click(screen.getByTestId(`${DIALOG}.cancel-button`))
    expect(await screen.findByText('organisation.notes.delete-button: false')).toBeDefined()

    await user.click(screen.getByText('organisation.notes.delete-button: false'))
    await user.click(await screen.findByTestId(`${DIALOG}.confirm-button`))
    expect(await screen.findByText('organisation.notes.delete-button: true')).toBeDefined()
  })

  it('goes ahead at once for a control whose action destroys nothing', async () => {
    const user = userEvent.setup()

    await open()
    await user.click(screen.getByText('x.other-button: none'))

    expect(await screen.findByText('x.other-button: true')).toBeDefined()
    expect(screen.queryByTestId(DIALOG)).toBeNull()
  })

  it('answers a question left open "stay" when a second one replaces it', async () => {
    // The dialog is modal: the page's second question comes as a guard call would, past it.
    const user = userEvent.setup({ pointerEventsCheck: 0 })

    await open()
    await user.click(screen.getByText('organisation.notes.delete-button: none'))
    await screen.findByText('Delete this note?')

    await user.click(screen.getByText('device.list.revoke-button: none'))

    expect(await screen.findByText('organisation.notes.delete-button: false')).toBeDefined()
    expect(await screen.findByText('Sign out that device?')).toBeDefined()
    expect(dialog('devices-revoke')).not.toBeNull()
  })

  it('takes the focus to cancel, stays on Escape, and gives the focus back to the control', async () => {
    const user = userEvent.setup()

    await open()

    const control = screen.getByText('organisation.notes.delete-button: none')

    await user.click(control)
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId(`${DIALOG}.cancel-button`))
    })

    await user.keyboard('{Escape}')

    expect(await screen.findByText('organisation.notes.delete-button: false')).toBeDefined()
    await waitFor(() => {
      expect(document.activeElement).toBe(
        screen.getByText('organisation.notes.delete-button: false'),
      )
    })
  })

  it('drops an open question when another screen opens: the action stays', async () => {
    const user = userEvent.setup()
    const router = await open()

    await user.click(screen.getByText('organisation.notes.delete-button: none'))
    await screen.findByText('Delete this note?')
    await act(() => router.navigate({ to: '/two' }))

    expect(await screen.findByText('two')).toBeDefined()
    await waitFor(() => {
      expect(answers).toEqual(['organisation.notes.delete-button: false'])
    })
    expect(screen.queryByText('Delete this note?')).toBeNull()
  })
})
