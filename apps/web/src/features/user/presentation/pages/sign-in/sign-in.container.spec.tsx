// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { err, errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { NoticeProvider } from '../../../../../platform/notices'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'
import { NOTICE_TEXTS } from '../../../../app-shell/presentation/shell/notice-texts'
import { SIGN_IN_SERVICE, SignInService } from '../../../application/sign-in.service'

import { SignInContainer } from './sign-in.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** What a sign-up asks the session for. */
type SignUpInput = Parameters<SessionPort['signUp']>[0]

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

/** Whether a field of the page holds unsaved input, as the frame's leave guard reads it. */
let unsavedNow = false

function UnsavedProbe() {
  unsavedNow = useUnsavedInput()

  return null
}

function renderSignIn(session: SessionPort) {
  const TestModule = defineModule({
    id: 'test',
    providers: [
      {
        provide: SIGN_IN_SERVICE,
        useFactory: () => new SignInService(session),
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
      <NoticeProvider texts={NOTICE_TEXTS}>
        <Outlet />
      </NoticeProvider>
    ),
    history: createMemoryHistory({ initialEntries: ['/sign-in'] }),
  })

  render(
    <I18nProvider locale="en" catalogs={{ en: englishCatalog }}>
      <ServicesProvider services={fakeServices(session)}>
        <UnsavedInputScope>
          <RouterProvider router={router} />
          <UnsavedProbe />
        </UnsavedInputScope>
      </ServicesProvider>
    </I18nProvider>,
  )

  return router
}

const typeInto = (testId: string, value: string) =>
  fireEvent.change(screen.getByTestId(testId), { target: { value } })

const submitButton = () => screen.getByTestId('user.sign-in.submit-button') as HTMLButtonElement

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

  it('asks to check the mail after a sign-up, staying on the page with the resend, and resends to the email typed', async () => {
    const resent: string[] = []
    const session: SessionPort = {
      ...fakeSession().session,
      signUp: () => okAsync(undefined),
      resendVerification: (email) => {
        resent.push(email)

        return okAsync(undefined)
      },
    }
    const router = renderSignIn(session)

    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    fireEvent.change(screen.getByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.name-input'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const message = await screen.findByTestId('user.sign-in.mail-message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain(ann.email)
    expect(router.state.location.pathname).toBe('/sign-in')
    // The form is back in the mode sign-in, with the email kept.
    expect(screen.queryByTestId('user.sign-in.password-confirmation-input')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.name-input')).toBeNull()
    expect((screen.getByTestId('user.sign-in.email-input') as HTMLInputElement).value).toBe(
      ann.email,
    )

    fireEvent.click(screen.getByTestId('user.sign-in.resend-button'))

    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(resent).toEqual([ann.email])
    expect(screen.getByTestId('user.sign-in.mail-message').getAttribute('data-code')).toBe(
      'check-your-mail',
    )
  })

  it('names the address the mail went to, whatever the email field holds afterwards', async () => {
    const bob = 'bob@example.test'
    const carol = 'carol@example.test'
    const session: SessionPort = {
      ...fakeSession().session,
      signUp: () => okAsync(undefined),
      resendVerification: () => okAsync(undefined),
    }
    const messageText = () => screen.getByTestId('user.sign-in.mail-message').textContent
    const typeEmail = (value: string) =>
      fireEvent.change(screen.getByTestId('user.sign-in.email-input'), { target: { value } })

    renderSignIn(session)
    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    typeEmail(ann.email)
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.name-input'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))
    await screen.findByTestId('user.sign-in.mail-message')

    // Typing another address after the sign-up keeps the message on the address the mail went to.
    typeEmail(bob)

    expect(messageText()).toContain(ann.email)
    expect(messageText()).not.toContain(bob)

    // A resend goes to the address typed, and the message names that one from then on.
    fireEvent.click(screen.getByTestId('user.sign-in.resend-button'))
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    typeEmail(carol)

    expect(messageText()).toContain(bob)
    expect(messageText()).not.toContain(carol)
  })

  it('offers the resend when a sign-in is refused because the email is not verified yet', async () => {
    const session: SessionPort = {
      ...fakeSession().session,
      signIn: () =>
        errAsync({ code: 'data:EMAIL_NOT_VERIFIED', message: 'the email is not verified yet' }),
    }
    const router = renderSignIn(session)

    fireEvent.change(await screen.findByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const error = await screen.findByTestId('user.sign-in.error')

    expect(error.getAttribute('data-code')).toBe('email-not-verified')
    expect(screen.getByTestId('user.sign-in.resend-button')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('keeps the mode sign-up while the sign-up runs and once it is refused, and goes back to sign-in on the toggle', async () => {
    let refuse: () => void = () => {}
    const session: SessionPort = {
      ...fakeSession().session,
      signUp: () =>
        new ResultAsync(
          new Promise<Awaited<ReturnType<SessionPort['signUp']>>>((resolve) => {
            refuse = () =>
              resolve(err({ code: 'data:SIGN_UP_REJECTED', message: 'sign-up was rejected' }))
          }),
        ),
    }

    renderSignIn(session)

    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    fireEvent.change(screen.getByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.name-input'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    // While it runs, the form stays in the mode sign-up, its submit held.
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))
    expect(screen.getByTestId('user.sign-in.name-input')).toBeTruthy()
    expect((screen.getByTestId('user.sign-in.submit-button') as HTMLButtonElement).disabled).toBe(
      true,
    )

    act(() => refuse())

    const error = await screen.findByTestId('user.sign-in.error')

    expect(error.getAttribute('data-code')).toBe('sign-up-rejected')
    expect(screen.getByTestId('user.sign-in.name-input')).toBeTruthy()
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-in',
    )

    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))

    expect(screen.queryByTestId('user.sign-in.password-confirmation-input')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.name-input')).toBeNull()
    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
  })

  it('says the passwords differ once the password typed again strays, holding the submit until it follows again', async () => {
    renderSignIn(fakeSession().session)

    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    typeInto('user.sign-in.password-input', 'pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'pass')

    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
    expect(submitButton().disabled).toBe(false)

    typeInto('user.sign-in.password-confirmation-input', 'pass-x')

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'passwords-differ',
    )
    expect(
      screen.getByTestId('user.sign-in.password-confirmation-input').getAttribute('aria-invalid'),
    ).toBe('true')
    expect(submitButton().disabled).toBe(true)

    typeInto('user.sign-in.password-confirmation-input', 'pass-word-1')

    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
    expect(submitButton().disabled).toBe(false)
  })

  it('never sends the password typed again: the session is asked for the account with the email, the password, the name and the language', async () => {
    const asked: SignUpInput[] = []
    const session: SessionPort = {
      ...fakeSession().session,
      signUp: (input) => {
        asked.push(input)

        return okAsync(undefined)
      },
    }

    renderSignIn(session)
    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    typeInto('user.sign-in.email-input', ann.email)
    typeInto('user.sign-in.password-input', 'pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'pass-word-1')
    typeInto('user.sign-in.name-input', 'Ann')
    fireEvent.click(submitButton())

    await screen.findByTestId('user.sign-in.mail-message')
    expect(asked).toStrictEqual([
      { email: ann.email, password: 'pass-word-1', name: 'Ann', locale: 'en' },
    ])
    // Asked for, what was typed is no longer unsaved, once the form has heard the submit's outcome.
    await waitFor(() => expect(unsavedNow).toBe(false))
  })

  it('asks for no account when only a part of the password was typed again, keeping what was typed unsaved', async () => {
    const asked: SignUpInput[] = []
    const session: SessionPort = {
      ...fakeSession().session,
      signUp: (input) => {
        asked.push(input)

        return okAsync(undefined)
      },
    }

    renderSignIn(session)
    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    typeInto('user.sign-in.email-input', ann.email)
    typeInto('user.sign-in.password-input', 'pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'pass-word')
    typeInto('user.sign-in.name-input', 'Ann')
    fireEvent.click(submitButton())
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)))

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'passwords-differ',
    )
    expect(submitButton().disabled).toBe(true)
    expect(screen.getByTestId('user.sign-in.toggle-button').getAttribute('data-value')).toBe(
      'sign-in',
    )
    expect(asked).toEqual([])
    expect(unsavedNow).toBe(true)
  })
})
