// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { memoryTheme } from '../../../../../platform/__fixtures__/theme'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'
import { SettingsWritesContext } from '../../../../../platform/settings-writes'
import { ThemeContext } from '../../../../../platform/theme'

import { SettingsContainer } from './settings.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** What a change of the password answers. */
type ChangeAnswer = ReturnType<SessionPort['changePassword']>

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

/** Whether a field of the page holds unsaved input, as the frame's leave guard reads it. */
let unsavedNow = false

function UnsavedProbe() {
  unsavedNow = useUnsavedInput()

  return null
}

/** What a request for the account's deletion answers. */
type DeletionAnswer = ReturnType<SessionPort['requestAccountDeletion']>

function open(
  answer: () => ChangeAnswer,
  deletion: () => DeletionAnswer = () => okAsync(undefined),
) {
  const changePassword = vi.fn((_current: string, _password: string) => answer())
  const requestAccountDeletion = vi.fn((_password: string) => deletion())
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => ann,
    changePassword,
    requestAccountDeletion,
  }
  const TestModule = defineModule({
    id: 'test',
    declarations: { Settings: SettingsContainer },
    routes: [{ path: '/settings', page: 'Settings', guard: 'authenticated', roles: ['identity'] }],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: ['/settings'] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={fakeServices(session)}>
        <ThemeContext.Provider value={memoryTheme()}>
          <SettingsWritesContext.Provider
            value={{ locale: { writing: () => () => {} }, theme: { writing: () => () => {} } }}
          >
            <UnsavedInputScope>
              <RouterProvider router={router} />
              <UnsavedProbe />
            </UnsavedInputScope>
          </SettingsWritesContext.Provider>
        </ThemeContext.Provider>
      </ServicesProvider>
    </I18nProvider>,
  )

  return { changePassword, requestAccountDeletion }
}

const CURRENT = 'user.settings.password.current-password-input'
const NEW = 'user.settings.password.new-password-input'
const CONFIRMATION = 'user.settings.password.password-confirmation-input'
const DELETION_PASSWORD = 'user.settings.deletion.password-input'

const value = (testId: string) => (screen.getByTestId(testId) as HTMLInputElement).value

/** Types the current password and the new one twice, and saves. */
async function change(): Promise<void> {
  await screen.findByTestId('user.settings.password.form')

  for (const [testId, typed] of [
    [CURRENT, 'Secret-old1'],
    [NEW, 'Secret-new1'],
    [CONFIRMATION, 'Secret-new1'],
  ] as const) {
    fireEvent.change(screen.getByTestId(testId), { target: { value: typed } })
  }

  expect(unsavedNow).toBe(true)
  await act(async () => fireEvent.click(screen.getByTestId('user.settings.password.save-button')))
}

describe('SettingsContainer', () => {
  it('changes the password, then empties the form, which holds no input any more', async () => {
    const { changePassword } = open(() => okAsync(undefined))

    await change()

    await waitFor(() => expect(value(CURRENT)).toBe(''))
    expect(changePassword).toHaveBeenCalledWith('Secret-old1', 'Secret-new1')
    expect(value(NEW)).toBe('')
    expect(value(CONFIRMATION)).toBe('')
    await waitFor(() => expect(unsavedNow).toBe(false))
  })

  it('keeps the form as typed when the change is refused, under the field its code concerns', async () => {
    open(() => errAsync({ code: 'data:INVALID_CREDENTIALS' as const, message: 'wrong' }))

    await change()

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.password.error').getAttribute('data-code')).toBe(
        'invalid-credentials',
      ),
    )
    expect(value(CURRENT)).toBe('Secret-old1')
    expect(value(NEW)).toBe('Secret-new1')
    expect(unsavedNow).toBe(true)
  })

  it('shows the deletion form with its anchors, and no message before a send', async () => {
    open(() => okAsync(undefined))

    for (const anchor of [
      'user.settings.deletion.form',
      'user.settings.deletion.password-input',
      'user.settings.deletion.send-button',
    ]) {
      expect(await screen.findByTestId(anchor)).toBeTruthy()
    }

    expect(screen.queryByTestId('user.settings.deletion.message')).toBeNull()
    expect(screen.queryByTestId('user.settings.deletion.error')).toBeNull()
  })

  it('sends the deletion link with the password, says so, then empties the password', async () => {
    const { requestAccountDeletion } = open(() => okAsync(undefined))

    await screen.findByTestId('user.settings.deletion.form')
    fireEvent.change(screen.getByTestId(DELETION_PASSWORD), { target: { value: 'Secret-ann1' } })
    expect(unsavedNow).toBe(true)
    await act(async () => fireEvent.click(screen.getByTestId('user.settings.deletion.send-button')))

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.deletion.message').getAttribute('data-code')).toBe(
        'check-your-mail',
      ),
    )
    expect(requestAccountDeletion).toHaveBeenCalledWith('Secret-ann1')
    await waitFor(() => expect(value(DELETION_PASSWORD)).toBe(''))
    await waitFor(() => expect(unsavedNow).toBe(false))
  })

  it('keeps the password as typed when the request is refused, and says why', async () => {
    open(
      () => okAsync(undefined),
      () => errAsync({ code: 'data:INVALID_CREDENTIALS' as const, message: 'wrong' }),
    )

    await screen.findByTestId('user.settings.deletion.form')
    fireEvent.change(screen.getByTestId(DELETION_PASSWORD), { target: { value: 'Wrong-pass1' } })
    await act(async () => fireEvent.click(screen.getByTestId('user.settings.deletion.send-button')))

    await waitFor(() =>
      expect(screen.getByTestId('user.settings.deletion.error').getAttribute('data-code')).toBe(
        'invalid-credentials',
      ),
    )
    expect(value(DELETION_PASSWORD)).toBe('Wrong-pass1')
    expect(screen.queryByTestId('user.settings.deletion.message')).toBeNull()
  })
})
