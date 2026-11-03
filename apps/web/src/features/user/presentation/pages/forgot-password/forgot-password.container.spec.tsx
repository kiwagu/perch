// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionNotice, SessionPort } from '../../../../../platform/session.port'

import { ForgotPasswordContainer } from './forgot-password.container'

const EMAIL_SEARCH = z.object({ email: z.string().max(254).optional() })

function open(at: string) {
  const requestPasswordReset = vi.fn((_email: string) => okAsync(undefined))
  // What happened, in order: the word left for the sign-in page, and the move there.
  const happened: string[] = []
  const leaveNotice = vi.fn((notice: SessionNotice) => {
    happened.push(`notice ${notice}`)
  })
  const session: SessionPort = { ...fakeSession().session, requestPasswordReset, leaveNotice }
  const TestModule = defineModule({
    id: 'test',
    declarations: {
      Forgot: ForgotPasswordContainer,
      SignIn: () => {
        happened.push('sign-in')

        return <p>sign-in</p>
      },
    },
    routes: [
      { path: '/forgot-password', page: 'Forgot', guard: 'guest', search: EMAIL_SEARCH },
      { path: '/sign-in', page: 'SignIn', guard: 'guest', search: EMAIL_SEARCH },
    ],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => <Outlet />,
    history: createMemoryHistory({ initialEntries: [at] }),
  })
  const services = fakeServices(session)

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={services}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )

  return { requestPasswordReset, leaveNotice, happened, router, services }
}

const emailInput = async () =>
  (await screen.findByTestId('user.forgot-password.email-input')) as HTMLInputElement

/** Asks for the mail with what the field holds, and waits for the page to say it went. */
async function send(): Promise<void> {
  fireEvent.click(screen.getByTestId('user.forgot-password.send-button'))
  await waitFor(() =>
    expect(screen.getByTestId('user.forgot-password.message').getAttribute('data-code')).toBe(
      'check-your-mail',
    ),
  )
}

describe('ForgotPasswordContainer', () => {
  it('fills the email from the address and asks for the mail with it', async () => {
    const { requestPasswordReset } = open('/forgot-password?email=ann%40example.test')

    expect((await emailInput()).value).toBe('ann@example.test')

    await send()

    expect(requestPasswordReset).toHaveBeenCalledWith('ann@example.test')
  })

  it('starts empty without an email in the address', async () => {
    open('/forgot-password')

    expect((await emailInput()).value).toBe('')
  })

  it('follows a new password set in another tab once the mail was asked for: it leaves the sign-in page its word, then moves there with the email as typed', async () => {
    const { happened, router, services } = open('/forgot-password')

    fireEvent.change(await emailInput(), { target: { value: 'ann@example.test' } })
    await send()
    // The field as typed now, not the address asked for, goes with the move.
    fireEvent.change(await emailInput(), { target: { value: 'ann.b@example.test' } })
    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    await screen.findByText('sign-in')
    expect(router.state.location.pathname).toBe('/sign-in')
    expect(router.state.location.search).toEqual({ email: 'ann.b@example.test' })
    expect(happened).toEqual(['notice password-reset-elsewhere', 'sign-in'])
  })

  it('stays when a new password is set in another tab before it asked for the mail', async () => {
    const { leaveNotice, router, services } = open('/forgot-password?email=ann%40example.test')

    await emailInput()
    act(() => services.platformEvent({ type: 'platform.password-reset' }))

    expect(router.state.location.pathname).toBe('/forgot-password')
    expect(leaveNotice).not.toHaveBeenCalled()
  })
})
