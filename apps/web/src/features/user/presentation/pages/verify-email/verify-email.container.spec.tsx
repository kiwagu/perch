// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { errAsync, okAsync } from 'neverthrow'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory } from '@workspace/ids'
import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { NoticeProvider, useNotice } from '../../../../../platform/notices'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { EmailVerified, SessionPort } from '../../../../../platform/session.port'
import { NOTICE_TEXTS } from '../../../../app-shell/presentation/shell/notice-texts'
import { VERIFY_EMAIL_SERVICE, VerifyEmailService } from '../../../application/verify-email.service'

import { VerifyEmailContainer } from './verify-email.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }

const signedIn: EmailVerified = { kind: 'signed-in', user: ann, name: 'Ann', locale: 'en' }

const verifiedBefore: EmailVerified = { kind: 'verified-before' }

type Exchange = ReturnType<SessionPort['verifyEmail']>

/**
 * A verification service over a session that answers each exchange of a token in turn, the last
 * answer again for any later one, and counts them; the accounts it starts are counted too.
 */
function verifying(answers: readonly (() => Exchange)[]) {
  const exchange = vi.fn((_token: string): Exchange => {
    const answer = answers[Math.min(exchange.mock.calls.length - 1, answers.length - 1)]

    return answer ? answer() : expect.unreachable('an answer')
  })
  const resend = vi.fn((_email: string) => okAsync(undefined))
  const started: string[] = []
  const service = new VerifyEmailService(
    { verifyEmail: exchange, resendVerification: resend },
    {
      start: (user) => {
        started.push(user.id)

        return okAsync(undefined)
      },
    },
  )

  return { service, exchange, resend, started }
}

/** The notice the frame shows, by its code. */
function CurrentNotice() {
  const notice = useNotice()

  return notice ? <p data-code={notice.code}>notice</p> : null
}

/** The verify page at `path`, inside StrictMode as in development, with the frame's notice. */
function renderPage(service: VerifyEmailService, path = '/verify-email?token=the-token') {
  const TestModule = defineModule({
    id: 'test',
    providers: [{ provide: VERIFY_EMAIL_SERVICE, useFactory: () => service }],
    declarations: {
      VerifyEmail: VerifyEmailContainer,
      Me: () => <p>profile</p>,
      SignIn: () => <p>sign in</p>,
    },
    routes: [
      {
        path: '/verify-email',
        page: 'VerifyEmail',
        guard: 'guest',
        search: z.object({ token: z.string().min(1).max(4096).optional() }),
      },
      { path: '/me', page: 'Me' },
      { path: '/sign-in', page: 'SignIn' },
    ],
  })
  const { session } = fakeSession()
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => (
      <NoticeProvider texts={NOTICE_TEXTS}>
        <CurrentNotice />
        <Outlet />
      </NoticeProvider>
    ),
    history: createMemoryHistory({ initialEntries: [path] }),
  })
  const { unmount } = render(
    <StrictMode>
      <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
        <ServicesProvider services={fakeServices(session)}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </I18nProvider>
    </StrictMode>,
  )

  return { router, unmount }
}

const noticeCode = () => document.querySelector('p[data-code]')?.getAttribute('data-code')

describe('VerifyEmailContainer', () => {
  it('exchanges the token of the address once, though StrictMode starts its machine again, and lands on the profile with the welcome', async () => {
    const { service, exchange, started } = verifying([() => okAsync(signedIn)])
    const { router } = renderPage(service)

    await screen.findByText('profile')

    expect(router.state.location.pathname).toBe('/me')
    expect(noticeCode()).toBe('welcome')
    expect(exchange).toHaveBeenCalledExactlyOnceWith('the-token')
    expect(started).toEqual([ann.id])
  })

  it('asks afresh when the page is opened again with the same token, after a visit that ended', async () => {
    const { service, exchange, started } = verifying([
      () => okAsync(signedIn),
      () => okAsync(verifiedBefore),
    ])
    const first = renderPage(service)

    await screen.findByText('profile')
    first.unmount()

    renderPage(service)

    const message = await screen.findByTestId('user.verify-email.message')

    expect(message.getAttribute('data-code')).toBe('verified-before')
    expect(screen.getByTestId('user.verify-email.sign-in-link').getAttribute('href')).toBe(
      '/sign-in',
    )
    expect(exchange).toHaveBeenCalledTimes(2)
    expect(started).toEqual([ann.id])
  })

  it('keeps no failed exchange: opened again, the page asks again and shows the new answer', async () => {
    const { service, exchange } = verifying([
      () => errAsync({ code: 'data:OFFLINE', message: 'the gateway could not be reached' }),
      () => okAsync(verifiedBefore),
    ])
    const first = renderPage(service)

    expect((await screen.findByTestId('user.verify-email.error')).getAttribute('data-code')).toBe(
      'failed',
    )
    first.unmount()

    renderPage(service)

    expect((await screen.findByTestId('user.verify-email.message')).getAttribute('data-code')).toBe(
      'verified-before',
    )
    expect(screen.queryByTestId('user.verify-email.error')).toBeNull()
    expect(exchange).toHaveBeenCalledTimes(2)
  })

  it('exchanges the token the address names now when the page moves to another link, its outcome replacing the first', async () => {
    const { service, exchange } = verifying([
      () => okAsync(verifiedBefore),
      () => errAsync({ code: 'data:LINK_INVALID', message: 'the gateway refused the link' }),
    ])
    const { router } = renderPage(service, '/verify-email?token=first')

    expect((await screen.findByTestId('user.verify-email.message')).getAttribute('data-code')).toBe(
      'verified-before',
    )

    act(() => router.history.push('/verify-email?token=second'))

    expect((await screen.findByTestId('user.verify-email.error')).getAttribute('data-code')).toBe(
      'link-invalid',
    )
    expect(screen.queryByTestId('user.verify-email.message')).toBeNull()
    expect(exchange.mock.calls).toEqual([['first'], ['second']])
  })

  it('sends a new link to the email typed once the link is refused, and says it is on its way', async () => {
    const { service, resend } = verifying([
      () => errAsync({ code: 'data:LINK_INVALID', message: 'the gateway refused the link' }),
    ])

    renderPage(service)

    expect((await screen.findByTestId('user.verify-email.error')).getAttribute('data-code')).toBe(
      'link-invalid',
    )

    fireEvent.change(screen.getByTestId('user.verify-email.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.click(screen.getByTestId('user.verify-email.resend-button'))

    const message = await screen.findByTestId('user.verify-email.message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain(ann.email)
    expect(screen.queryByTestId('user.verify-email.error')).toBeNull()
    expect(resend).toHaveBeenCalledExactlyOnceWith(ann.email)

    // Typing another address after it went keeps the message on the address it went to.
    fireEvent.change(screen.getByTestId('user.verify-email.email-input'), {
      target: { value: 'someone-else@example.test' },
    })

    expect(screen.getByTestId('user.verify-email.message').textContent).toContain(ann.email)
    expect(screen.getByTestId('user.verify-email.message').textContent).not.toContain(
      'someone-else@example.test',
    )
  })

  it('exchanges an empty token when the address carries none', async () => {
    const { service, exchange } = verifying([
      () => errAsync({ code: 'data:LINK_INVALID', message: 'the link carries no token' }),
    ])

    renderPage(service, '/verify-email')

    expect((await screen.findByTestId('user.verify-email.error')).getAttribute('data-code')).toBe(
      'link-invalid',
    )
    expect(exchange).toHaveBeenCalledExactlyOnceWith('')
  })
})
