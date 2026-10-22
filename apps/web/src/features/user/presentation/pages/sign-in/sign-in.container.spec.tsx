// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen } from '@testing-library/react'
import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { NoticeProvider } from '../../../../../platform/notices'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'
import { SIGN_IN_SERVICE, SignInService } from '../../../application/sign-in.service'

import { SignInContainer } from './sign-in.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

const ann: AuthUser = {
  id: 'idn_0000000000000000.01m52pexcp' as AuthUser['id'],
  email: 'ann@example.test',
}

/**
 * A session nobody is signed in to until a test says so, as another tab's sign-in or this
 * page's own would; this page's sign-in answers once the test lets it.
 */
function switchableSession() {
  let user: AuthUser | undefined
  let answer: (result: AuthUser) => void = () => {}
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const signIn = (): ReturnType<SessionPort['signIn']> =>
    ResultAsync.fromSafePromise(
      new Promise<AuthUser>((resolve) => {
        answer = resolve
      }),
    )
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => user,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    signIn,
  }

  return {
    session,
    /** Someone is signed in now: the session tells its listeners. */
    signedIn: (next: AuthUser) => {
      user = next

      for (const listener of listeners) {
        listener(next)
      }
    },
    /** The page's own sign-in answers. */
    answer: (next: AuthUser) => answer(next),
  }
}

function renderSignIn(session: SessionPort) {
  const TestModule = defineModule({
    id: 'test',
    providers: [
      {
        provide: SIGN_IN_SERVICE,
        useFactory: () => new SignInService(session, { createProfile: () => okAsync(undefined) }),
      },
    ],
    declarations: { SignIn: SignInContainer, Me: () => <p>profile</p> },
    routes: [
      { path: '/sign-in', page: 'SignIn', guard: 'guest' },
      { path: '/me', page: 'Me', guard: 'authenticated' },
    ],
  })
  const router = createAppRouter({
    modules: [TestModule],
    session,
    layout: () => (
      <NoticeProvider>
        <Outlet />
      </NoticeProvider>
    ),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={fakeServices(session)}>
        <RouterProvider router={router} />
      </ServicesProvider>
    </I18nProvider>,
  )

  return router
}

describe('SignInContainer', () => {
  it('moves to the profile once another tab signs someone in: one account per browser', async () => {
    const { session, signedIn } = switchableSession()
    const router = renderSignIn(session)

    await screen.findByTestId('user.sign-in.email-input')
    act(() => signedIn(ann))

    await screen.findByText('profile')
    expect(router.state.location.pathname).toBe('/me')
  })

  it('stays while its own sign-in runs, though the session already tells of the user', async () => {
    const { session, signedIn, answer } = switchableSession()
    const router = renderSignIn(session)

    fireEvent.change(await screen.findByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))
    // The session opens the space and tells its listeners before the sign-in answers.
    act(() => signedIn(ann))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(router.state.location.pathname).toBe('/sign-in')

    act(() => answer(ann))

    await screen.findByText('profile')
  })
})
