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

import { ResetPasswordContainer } from './reset-password.container'

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

/**
 * The page at `at` over a session signed in as Ann, whose reset answers as `answer` says and, once
 * it went through, signs this device out as the channel's 4002 does.
 */
function open(at: string, answer: () => ResetAnswer = () => okAsync(undefined)) {
  let user: AuthUser | undefined = ann
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const resetPassword = vi.fn((_token: string, _password: string) =>
    answer().andTee(() => {
      user = undefined

      for (const listener of listeners) {
        listener(undefined)
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
        path: '/reset-password',
        page: 'Reset',
        roles: ['guest', 'identity'],
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

  return { resetPassword, session }
}

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
    const { resetPassword, session } = open('/reset-password?token=the-token')

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

  it('takes the form away for a link that does not work, and offers a new one', async () => {
    open('/reset-password?token=used', () =>
      errAsync({ code: 'data:LINK_INVALID' as const, message: 'used' }),
    )

    await setTwice('Secret-new1')

    await waitFor(() =>
      expect(screen.getByTestId('user.reset-password.error').getAttribute('data-code')).toBe(
        'link-invalid',
      ),
    )
    expect(screen.getByTestId('user.reset-password.forgot-link')).toBeTruthy()
    expect(screen.queryByTestId('user.reset-password.form')).toBeNull()
  })
})
