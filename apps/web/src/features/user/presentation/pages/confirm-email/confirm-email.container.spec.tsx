// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { render, screen } from '@testing-library/react'
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

import { ConfirmEmailContainer } from './confirm-email.container'

/** Who a session says is signed in. */
type AuthUser = NonNullable<ReturnType<SessionPort['current']>>

const ann: AuthUser = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob: AuthUser = { id: identityIdFactory.create(), email: 'bob@example.test' }

/** The page at `at`, `here` signed in, over a confirmation that answers as `answer` says. */
function open(
  at: string,
  here: AuthUser | undefined,
  answer: ReturnType<SessionPort['confirmEmail']> = okAsync({
    identity: ann.id,
    email: 'ann.new@example.test',
  }),
) {
  const confirmEmail = vi.fn((_token: string) => answer)
  const session: SessionPort = { ...fakeSession().session, current: () => here, confirmEmail }
  const TestModule = defineModule({
    id: 'test',
    declarations: { Confirm: ConfirmEmailContainer },
    routes: [
      {
        path: '/confirm-email',
        page: 'Confirm',
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

  return { confirmEmail }
}

describe('ConfirmEmailContainer', () => {
  it('confirms the token of its address once, and leads this account to its profile', async () => {
    const { confirmEmail } = open('/confirm-email?token=the-token', ann)

    expect(await screen.findByTestId('user.confirm-email.profile-link')).toBeTruthy()
    expect(confirmEmail).toHaveBeenCalledTimes(1)
    expect(confirmEmail).toHaveBeenCalledWith('the-token')
  })

  it('leads a guest to the sign-in page', async () => {
    open('/confirm-email?token=the-token', undefined)

    expect(await screen.findByTestId('user.confirm-email.sign-in-link')).toBeTruthy()
  })

  it('leads nowhere while another account is signed in here', async () => {
    open('/confirm-email?token=the-token', bob)

    expect(
      (await screen.findByTestId('user.confirm-email.message')).getAttribute('data-code'),
    ).toBe('email-changed')
    expect(screen.queryByTestId('user.confirm-email.profile-link')).toBeNull()
    expect(screen.queryByTestId('user.confirm-email.sign-in-link')).toBeNull()
  })

  it('says why a refused link changed nothing', async () => {
    open(
      '/confirm-email?token=used',
      ann,
      errAsync({ code: 'data:LINK_INVALID' as const, message: 'used' }),
    )

    expect((await screen.findByTestId('user.confirm-email.error')).getAttribute('data-code')).toBe(
      'link-invalid',
    )
  })
})
