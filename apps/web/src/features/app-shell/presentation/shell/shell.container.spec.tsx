// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'

import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { defineModule } from '../../../../platform/module'
import { NoticeProvider } from '../../../../platform/notices'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'

import { ShellContainer } from './shell.container'

const HomeModule = defineModule({
  id: 'home',
  declarations: { Home: () => <p>home</p> },
  routes: [{ path: '/home', page: 'Home' }],
})

describe('ShellContainer', () => {
  it('tells the user of a change the gateway refused and this device undid', async () => {
    const { session, reject } = fakeSession()
    const router = createAppRouter({
      modules: [HomeModule],
      session,
      layout: () => (
        <NoticeProvider>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ServicesProvider services={fakeServices(session)}>
          <RouterProvider router={router} />
        </ServicesProvider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    expect(screen.queryByTestId('app-shell.notice')).toBeNull()

    act(() =>
      reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
      }),
    )

    expect((await screen.findByTestId('app-shell.notice')).textContent).toBe(
      'The server refused a change and undid it on this device.',
    )
  })
})
