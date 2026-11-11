// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { err, errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { UnsavedInputScope, useUnsavedInput } from '@workspace/ui/unsaved-input'
import { z } from '@workspace/zod'

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
 * page's own would; this page's sign-in answers once the test lets it, and is this tab's own
 * until then.
 */
function switchableSession() {
  let user: AuthUser | undefined
  let here = false
  let answer: (result: AuthUser) => void = () => {}
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const signIn = (): ReturnType<SessionPort['signIn']> => {
    here = true

    return ResultAsync.fromSafePromise(
      new Promise<AuthUser>((resolve) => {
        answer = (result) => {
          here = false
          resolve(result)
        }
      }),
    )
  }
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => user,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    signingInHere: () => here,
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

function renderSignIn(session: SessionPort, at = '/sign-in') {
  const TestModule = defineModule({
    id: 'test',
    providers: [
      {
        provide: SIGN_IN_SERVICE,
        useFactory: () => new SignInService(session),
      },
    ],
    declarations: {
      SignIn: SignInContainer,
      Me: () => <p>profile</p>,
      Forgot: () => <p>forgot</p>,
    },
    routes: [
      {
        path: '/sign-in',
        page: 'SignIn',
        guard: 'guest',
        search: z.object({ email: z.string().max(254).optional() }),
      },
      { path: '/me', page: 'Me', guard: 'authenticated' },
      { path: '/forgot-password', page: 'Forgot' },
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
    history: createMemoryHistory({ initialEntries: [at] }),
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

/** The rules the list marks `met`, by the name of their item, in its order. */
const metRules = () =>
  [...screen.getByTestId('user.sign-in.password-rule-list').children]
    .filter((item) => item.getAttribute('data-state') === 'met')
    .map((item) =>
      (item.getAttribute('data-testid') ?? '').replace(
        /^user\.sign-in\.password-rule-list\.(.+)-item$/,
        '$1',
      ),
    )

describe('SignInContainer', () => {
  it('starts with the email the address carries, and says once the word left for it', async () => {
    const clearNotice = vi.fn()
    const session: SessionPort = {
      ...fakeSession().session,
      notice: () => 'password-reset-elsewhere',
      clearNotice,
    }

    renderSignIn(session, '/sign-in?email=ann%40example.test')

    expect(
      ((await screen.findByTestId('user.sign-in.email-input')) as HTMLInputElement).value,
    ).toBe('ann@example.test')
    expect(screen.getByTestId('user.sign-in.notice-message').getAttribute('data-code')).toBe(
      'password-reset-elsewhere',
    )
    expect(clearNotice).toHaveBeenCalled()
  })

  it('starts with an empty email without one in the address', async () => {
    renderSignIn(fakeSession().session)

    expect(
      ((await screen.findByTestId('user.sign-in.email-input')) as HTMLInputElement).value,
    ).toBe('')
  })

  it('moves to ask for a reset mail with the email typed, never the password', async () => {
    const router = renderSignIn(fakeSession().session)

    await screen.findByTestId('user.sign-in.form')
    typeInto('user.sign-in.email-input', 'ann@example.test')
    typeInto('user.sign-in.password-input', 'Secret-ann1')
    fireEvent.click(screen.getByTestId('user.sign-in.forgot-link'))

    await screen.findByText('forgot')
    expect(router.state.location.pathname).toBe('/forgot-password')
    expect(router.state.location.search).toEqual({ email: 'ann@example.test' })
    expect(router.state.location.href).not.toContain('Secret')
  })

  it('moves to ask for a reset mail with no email when none is typed', async () => {
    const router = renderSignIn(fakeSession().session)

    fireEvent.click(await screen.findByTestId('user.sign-in.forgot-link'))

    await screen.findByText('forgot')
    expect(router.state.location.search).toEqual({})
  })

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
      target: { value: 'Pass-word-1' },
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
      target: { value: 'Pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'Pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.name-input'), { target: { value: 'Ann' } })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const message = await screen.findByTestId('user.sign-in.mail-message')

    expect(message.getAttribute('data-code')).toBe('check-your-mail')
    expect(message.textContent).toContain(ann.email)
    expect(router.state.location.pathname).toBe('/sign-in')
    // The form is back in the mode sign-in, with the email kept.
    expect(screen.queryByTestId('user.sign-in.password-rule-list')).toBeNull()
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
      target: { value: 'Pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'Pass-word-1' },
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

  it('asks before signing in past the limit of devices, then signs in all the same once confirmed', async () => {
    let user: AuthUser | undefined
    const confirmations: Array<boolean | undefined> = []
    const session: SessionPort = {
      ...fakeSession().session,
      current: () => user,
      signIn: (input) => {
        confirmations.push(input.signOutOldest)

        if (input.signOutOldest !== true) {
          return errAsync({
            code: 'data:DEVICE_LIMIT',
            message: 'the account is on as many devices as it may be',
          })
        }

        user = ann

        return okAsync(ann)
      },
    }
    const router = renderSignIn(session)

    fireEvent.change(await screen.findByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'Pass-word-1' },
    })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const dialog = await screen.findByTestId('user.sign-in.device-limit-dialog')

    expect(dialog.getAttribute('data-code')).toBe('device-limit')
    expect(router.state.location.pathname).toBe('/sign-in')

    fireEvent.click(screen.getByTestId('user.sign-in.device-limit-dialog.confirm-button'))

    await screen.findByText('profile')
    expect(router.state.location.pathname).toBe('/me')
    expect(confirmations).toEqual([undefined, true])
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
      target: { value: 'Pass-word-1' },
    })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const error = await screen.findByTestId('user.sign-in.error')

    expect(error.getAttribute('data-code')).toBe('email-not-verified')
    expect(screen.getByTestId('user.sign-in.resend-button')).toBeTruthy()
    expect(router.state.location.pathname).toBe('/sign-in')
  })

  it('tells a banned account it cannot sign in, offering no resend, keeping the email typed', async () => {
    const session: SessionPort = {
      ...fakeSession().session,
      signIn: () => errAsync({ code: 'data:ACCOUNT_BANNED', message: 'the account is banned' }),
    }
    const router = renderSignIn(session)

    fireEvent.change(await screen.findByTestId('user.sign-in.email-input'), {
      target: { value: ann.email },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-input'), {
      target: { value: 'Pass-word-1' },
    })
    fireEvent.click(screen.getByTestId('user.sign-in.submit-button'))

    const error = await screen.findByTestId('user.sign-in.error')

    expect(error.getAttribute('data-code')).toBe('account-banned')
    expect(screen.queryByTestId('user.sign-in.resend-button')).toBeNull()
    expect(screen.getByTestId('user.sign-in.email-input').getAttribute('value')).toBe(ann.email)
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
      target: { value: 'Pass-word-1' },
    })
    fireEvent.change(screen.getByTestId('user.sign-in.password-confirmation-input'), {
      target: { value: 'Pass-word-1' },
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
    typeInto('user.sign-in.password-input', 'Pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'Pass')

    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
    expect(submitButton().disabled).toBe(false)

    typeInto('user.sign-in.password-confirmation-input', 'Pass-x')

    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'passwords-differ',
    )
    expect(
      screen.getByTestId('user.sign-in.password-confirmation-input').getAttribute('aria-invalid'),
    ).toBe('true')
    expect(submitButton().disabled).toBe(true)

    typeInto('user.sign-in.password-confirmation-input', 'Pass-word-1')

    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
    expect(submitButton().disabled).toBe(false)
  })

  it('marks the rules of a new password as it is typed, holding the submit while one is broken', async () => {
    renderSignIn(fakeSession().session)

    expect(screen.queryByTestId('user.sign-in.password-rule-list')).toBeNull()

    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))

    expect(screen.getByTestId('user.sign-in.password-rule-list')).toBeTruthy()
    expect(metRules()).toEqual([])
    expect(submitButton().disabled).toBe(true)

    typeInto('user.sign-in.password-input', 'abcdefghij')

    expect(metRules()).toEqual(['length', 'characters', 'lowercase'])
    expect(submitButton().disabled).toBe(true)

    typeInto('user.sign-in.password-input', 'Abcdefghij1!')

    expect(metRules()).toEqual([
      'length',
      'characters',
      'digit',
      'uppercase',
      'lowercase',
      'symbol',
    ])
    expect(screen.queryByTestId('user.sign-in.error')).toBeNull()
    expect(submitButton().disabled).toBe(false)

    typeInto('user.sign-in.password-input', 'Abcdefg hij1!')

    expect(metRules()).toEqual(['length', 'digit', 'uppercase', 'lowercase', 'symbol'])
    expect(submitButton().disabled).toBe(true)

    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))

    expect(screen.queryByTestId('user.sign-in.password-rule-list')).toBeNull()
  })

  it('judges the passwords typed in the mode sign-in on the switch to sign-up', async () => {
    renderSignIn(fakeSession().session)

    fireEvent.click(await screen.findByTestId('user.sign-in.toggle-button'))
    typeInto('user.sign-in.password-confirmation-input', 'Pass-x')
    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))
    // In the mode sign-in a keystroke in the password tells the flow nothing.
    typeInto('user.sign-in.password-input', 'Pass-word-1')
    fireEvent.click(screen.getByTestId('user.sign-in.toggle-button'))

    // The password keeps the rules, and the password typed again before no longer agrees with it.
    expect(metRules()).toHaveLength(6)
    expect(screen.getByTestId('user.sign-in.error').getAttribute('data-code')).toBe(
      'passwords-differ',
    )
    expect(submitButton().disabled).toBe(true)
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
    typeInto('user.sign-in.password-input', 'Pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'Pass-word-1')
    typeInto('user.sign-in.name-input', 'Ann')
    fireEvent.click(submitButton())

    await screen.findByTestId('user.sign-in.mail-message')
    expect(asked).toStrictEqual([
      { email: ann.email, password: 'Pass-word-1', name: 'Ann', locale: 'en' },
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
    typeInto('user.sign-in.password-input', 'Pass-word-1')
    typeInto('user.sign-in.password-confirmation-input', 'Pass-word')
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
