// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { okAsync } from 'neverthrow'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { z } from '@workspace/zod'

import { fakeServices, fakeSession } from '../../../../../platform/__fixtures__/session'
import { englishCatalog } from '../../../../../platform/catalogs'
import { defineModule } from '../../../../../platform/module'
import { createAppRouter } from '../../../../../platform/router'
import { ServicesProvider } from '../../../../../platform/services'
import type { SessionPort } from '../../../../../platform/session.port'

import { ForgotPasswordContainer } from './forgot-password.container'

function open(at: string) {
  const requestPasswordReset = vi.fn((_email: string) => okAsync(undefined))
  const session: SessionPort = { ...fakeSession().session, requestPasswordReset }
  const TestModule = defineModule({
    id: 'test',
    declarations: { Forgot: ForgotPasswordContainer },
    routes: [
      {
        path: '/forgot-password',
        page: 'Forgot',
        search: z.object({ email: z.string().max(254).optional() }),
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

  return { requestPasswordReset }
}

describe('ForgotPasswordContainer', () => {
  it('fills the email from the address and asks for the mail with it', async () => {
    const { requestPasswordReset } = open('/forgot-password?email=ann%40example.test')
    const email = (await screen.findByTestId(
      'user.forgot-password.email-input',
    )) as HTMLInputElement

    expect(email.value).toBe('ann@example.test')

    fireEvent.click(screen.getByTestId('user.forgot-password.send-button'))

    await waitFor(() =>
      expect(screen.getByTestId('user.forgot-password.message').getAttribute('data-code')).toBe(
        'check-your-mail',
      ),
    )
    expect(requestPasswordReset).toHaveBeenCalledWith('ann@example.test')
  })

  it('starts empty without an email in the address', async () => {
    open('/forgot-password')

    expect(
      ((await screen.findByTestId('user.forgot-password.email-input')) as HTMLInputElement).value,
    ).toBe('')
  })
})
