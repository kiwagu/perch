// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** What a reset answers. */
type ResetAnswer = ReturnType<SessionPort['resetPassword']>

import { CONTRACT_ROLES, CONTRACT_ROUTES } from '@workspace/kernel'

import { ResetPasswordContainer } from './reset-password.container'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

/**
 * The page at `at`, `here` signed in, over a reset of Ann's password that answers as `answer` says
 * and, once it went through, signs Ann's devices out as the channel's 4002 does; `signIn` changes
 * who is signed in on this device while the page is open, as another tab would.
 */
function open(
  at: string,
  here: AuthUser | undefined,
  answer: () => ResetAnswer = () => okAsync(undefined),
) {
  let user = here
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const tell = (next: AuthUser | undefined) => {
    user = next

    for (const listener of listeners) {
      listener(next)
    }
  }
  const resetPassword = vi.fn((_token: string, _password: string) =>
    answer().andTee(() => {
      if (user === ann) {
        tell(undefined)
      }
    }),
  )
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => user,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    resetPassword,
  }
  const TestModule = defineModule({
    id: 'test',
    declarations: { Reset: ResetPasswordContainer },
    routes: [
      {
        path: CONTRACT_ROUTES['user.reset-password'],
        page: 'Reset',
        roles: [CONTRACT_ROLES.guest, CONTRACT_ROLES.identity],
        search: z.object({ token: z.string().min(1).max(4096).optional() }),
      },
    ],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [at] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={fakeServices(session)}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )

  const signIn = (next: AuthUser | undefined) => act(() => tell(next))

  return { resetPassword, session, signIn }
}

/** A reset refused for a link used before. */
const used = () => errAsync({ code: 'data:LINK_INVALID' as const, message: 'used' })

/** The code an anchor of the page carries. */
const codeOf = (testId: string) => screen.getByTestId(testId).getAttribute('data-code')

/** Types the new password twice and submits it. */
async function setTwice(password: string): Promise<void> {
  const typing = (testId: string, value: string) =>
    fireEvent.change(screen.getByTestId(testId), { target: { value } })

  await screen.findByTestId('user.reset-password.form')
  typing('user.reset-password.password-input', password)
  typing('user.reset-password.password-confirmation-input', password)
  await act(async () => fireEvent.click(screen.getByTestId('user.reset-password.submit-button')))
}

describe('ResetPasswordContainer', () => {
  it("sets the password with the address's token, and keeps its message once its own reset signed this device out", async () => {
    const { resetPassword, session } = open(
      `${CONTRACT_ROUTES['user.reset-password']}?token=the-token`,
      ann,
    )

    await setTwice('Secret-new1')

    await waitFor(() =>
      expect(screen.getByTestId('user.reset-password.message').getAttribute('data-code')).toBe(
        'password-reset',
      ),
    )
    expect(resetPassword).toHaveBeenCalledWith('the-token', 'Secret-new1')
    expect(session.current()).toBeUndefined()
    expect(screen.getByTestId('user.reset-password.sign-in-link')).toBeTruthy()
  })

  it('keeps the sign-in link from another account signed in here, until it signs out', async () => {
    const { signIn } = open(`${CONTRACT_ROUTES['user.reset-password']}?token=the-token`, bob)

    await setTwice('Secret-new1')

    await waitFor(() => expect(codeOf('user.reset-password.message')).toBe('password-reset'))
    expect(screen.queryByTestId('user.reset-password.sign-in-link')).toBeNull()

    signIn(undefined)

    expect(await screen.findByTestId('user.reset-password.sign-in-link')).toBeTruthy()
    expect(codeOf('user.reset-password.message')).toBe('password-reset')
  })

  it('takes the form away for a link that does not work, and offers a guest a new one', async () => {
    open(`${CONTRACT_ROUTES['user.reset-password']}?token=used`, undefined, used)

    await setTwice('Secret-new1')

    await waitFor(() => expect(codeOf('user.reset-password.error')).toBe('link-invalid'))
    expect(screen.getByTestId('user.reset-password.forgot-link')).toBeTruthy()
    expect(screen.queryByTestId('user.reset-password.form')).toBeNull()
  })

  it('offers a new link only while nobody is signed in here', async () => {
    const { signIn } = open(`${CONTRACT_ROUTES['user.reset-password']}?token=used`, ann, used)

    await setTwice('Secret-new1')

    await waitFor(() => expect(codeOf('user.reset-password.error')).toBe('link-invalid'))
    expect(screen.queryByTestId('user.reset-password.forgot-link')).toBeNull()

    signIn(undefined)

    expect(await screen.findByTestId('user.reset-password.forgot-link')).toBeTruthy()

    signIn(ann)

    await waitFor(() => expect(screen.queryByTestId('user.reset-password.forgot-link')).toBeNull())
    expect(codeOf('user.reset-password.error')).toBe('link-invalid')
  })
})
