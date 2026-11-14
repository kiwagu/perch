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
import { ConfirmGuardContext } from '../../../../../platform/confirm-guard.port'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'

import { DeleteAccountContainer } from './delete-account.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

/** What a deletion answers. */
type DeleteAnswer = ReturnType<SessionPort['deleteAccount']>

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

const BUTTON = 'user.delete-account.delete-button'

interface Opening {
  /** Who is signed in when the page opens. */
  readonly signedIn?: AuthUser
  /** Whether the deletion signs this device out, as it does when the device is signed in to the account. */
  readonly signsOut?: boolean
  /** What the deletion answers, one answer per call; the last one repeats. */
  readonly answers?: readonly (() => DeleteAnswer)[]
  /** What the frame's confirmation answers. */
  readonly confirmed?: boolean
}

/** The page at `at` over a session that is signed in as `signedIn` says. */
function open(at: string, opening: Opening = {}) {
  const {
    signedIn,
    signsOut = false,
    answers = [() => okAsync(undefined)],
    confirmed = true,
  } = opening
  let user: AuthUser | undefined = signedIn
  let calls = 0
  const listeners = new Set<(next: AuthUser | undefined) => void>()
  const deleteAccount = vi.fn((_token: string) => {
    const answer = answers[Math.min(calls, answers.length - 1)] ?? expect.unreachable('an answer')

    calls += 1

    return answer().andTee(() => {
      if (signsOut) {
        user = undefined

        for (const listener of listeners) {
          listener(undefined)
        }
      }
    })
  })
  const session: SessionPort = {
    ...fakeSession().session,
    current: () => user,
    subscribe: (listener) => {
      listeners.add(listener)

      return () => listeners.delete(listener)
    },
    deleteAccount,
  }
  const asked: string[] = []
  const TestModule = defineModule({
    id: 'test',
    declarations: { Delete: DeleteAccountContainer },
    routes: [
      {
        path: '/delete-account',
        page: 'Delete',
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
        <ConfirmGuardContext.Provider
          value={{
            before: (control) => {
              asked.push(control)

              return Promise.resolve(confirmed)
            },
          }}
        >
          <RouterProvider router={router} />
        </ConfirmGuardContext.Provider>
      </ServicesProvider>
    </I18nProvider>,
  )

  return { deleteAccount, session, asked }
}

/** Presses the page's button once it is there. */
async function press(): Promise<void> {
  const button = await screen.findByTestId(BUTTON)

  await act(async () => fireEvent.click(button))
}

const refused = (code: 'data:LINK_INVALID' | 'data:LAST_ADMIN') => () =>
  errAsync({ code, message: 'refused' })

describe('DeleteAccountContainer', () => {
  it("asks the frame first, then deletes with the address's token, and tells a guest where to sign in", async () => {
    const { deleteAccount, asked } = open('/delete-account?token=the-token')

    await press()

    await waitFor(() =>
      expect(screen.getByTestId('user.delete-account.message').getAttribute('data-code')).toBe(
        'account-deleted',
      ),
    )
    expect(asked).toEqual([BUTTON])
    expect(deleteAccount).toHaveBeenCalledTimes(1)
    expect(deleteAccount).toHaveBeenCalledWith('the-token')
    expect(screen.getByTestId('user.delete-account.sign-in-link')).toBeTruthy()
    expect(screen.queryByTestId(BUTTON)).toBeNull()
  })

  it('deletes nothing when the user stays', async () => {
    const { deleteAccount, asked } = open('/delete-account?token=the-token', { confirmed: false })

    await press()

    expect(asked).toEqual([BUTTON])
    expect(deleteAccount).not.toHaveBeenCalled()
    expect(screen.queryByTestId('user.delete-account.message')).toBeNull()
    expect((screen.getByTestId(BUTTON) as HTMLButtonElement).disabled).toBe(false)
  })

  it('keeps its message once its own deletion signed this device out, and offers the sign-in then', async () => {
    const { session } = open('/delete-account?token=the-token', { signedIn: ann, signsOut: true })

    await screen.findByTestId(BUTTON)
    expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()

    await press()

    await waitFor(() =>
      expect(screen.getByTestId('user.delete-account.message').getAttribute('data-code')).toBe(
        'account-deleted',
      ),
    )
    expect(session.current()).toBeUndefined()
    expect(screen.getByTestId('user.delete-account.sign-in-link')).toBeTruthy()
  })

  it('keeps another account signed in here as it was, with the message and no link to sign in', async () => {
    const { session } = open('/delete-account?token=bobs', { signedIn: bob })

    await press()

    await waitFor(() => expect(screen.getByTestId('user.delete-account.message')).toBeTruthy())
    expect(session.current()).toBe(bob)
    expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()
  })

  it('takes the button away for a link that does not work', async () => {
    open('/delete-account?token=used', { answers: [refused('data:LINK_INVALID')] })

    await press()

    await waitFor(() =>
      expect(screen.getByTestId('user.delete-account.error').getAttribute('data-code')).toBe(
        'link-invalid',
      ),
    )
    expect(screen.queryByTestId(BUTTON)).toBeNull()
    expect(screen.queryByTestId('user.delete-account.sign-in-link')).toBeNull()
  })

  it('says the last admin must remove the other members, then deletes on a second press', async () => {
    const { deleteAccount } = open('/delete-account?token=the-token', {
      answers: [refused('data:LAST_ADMIN'), () => okAsync(undefined)],
    })

    await press()

    await waitFor(() =>
      expect(screen.getByTestId('user.delete-account.error').getAttribute('data-code')).toBe(
        'last-admin',
      ),
    )

    await press()

    await waitFor(() => expect(screen.getByTestId('user.delete-account.message')).toBeTruthy())
    expect(screen.queryByTestId('user.delete-account.error')).toBeNull()
    expect(deleteAccount).toHaveBeenCalledTimes(2)
  })

  it('asks the session with an empty token when the address names none', async () => {
    const { deleteAccount } = open('/delete-account', {
      answers: [refused('data:LINK_INVALID')],
    })

    await press()

    await waitFor(() => expect(screen.getByTestId('user.delete-account.error')).toBeTruthy())
    expect(deleteAccount).toHaveBeenCalledWith('')
  })
})
