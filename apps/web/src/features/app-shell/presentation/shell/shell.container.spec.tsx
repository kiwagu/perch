// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider } from '@workspace/i18n'
import { identityIdFactory, settingsIdFactory } from '@workspace/ids'

import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { defineModule } from '../../../../platform/module'
import { NoticeProvider } from '../../../../platform/notices'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'
import type { SessionPort } from '../../../../platform/session.port'
import { settingsShape } from '../../../user/application/settings/settings.model.gen'

import { openedFrame } from './__fixtures__/frame'
import { ShellContainer } from './shell.container'
import { ShellFrameContext } from './shell-frame'

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
        <ShellFrameContext.Provider value={openedFrame()}>
          <ServicesProvider services={fakeServices(session)}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </ShellFrameContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()

    act(() =>
      reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
        reloaded: false,
      }),
    )

    const rejected = await screen.findByTestId('app-shell.notice-message')

    expect(rejected.getAttribute('data-code')).toBe('change-rejected')
    expect(rejected.textContent).toBe('The server refused a change and undid it on this device.')

    // The undo was refused too: the region came back from the server without the later changes.
    act(() =>
      reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
        reloaded: true,
      }),
    )

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.notice-message').getAttribute('data-code')).toBe(
        'changes-reloaded',
      ),
    )
    expect(screen.getByTestId('app-shell.notice-message').textContent).toBe(
      'The server refused a change again, so it and the later changes not yet sent were undone on this device.',
    )
  })

  it("takes a language choice once the signed-in account's settings are on the device", async () => {
    const { session } = fakeSession()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const signedIn: SessionPort = { ...session, current: () => ann }
    const services = fakeServices(signedIn)
    const router = createAppRouter({
      modules: [HomeModule],
      session: signedIn,
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
        <ShellFrameContext.Provider value={openedFrame()}>
          <ServicesProvider services={services}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </ShellFrameContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    // Signed in, the settings not here yet: the frame takes no choice.
    expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(true)

    act(() => {
      services.runner.set(settingsShape, [{ id: settingsIdFactory.create(), locale: 'en' }])
    })

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(
        false,
      ),
    )
  })

  it("speaks no signed-out account's stored language", async () => {
    const { session } = fakeSession()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const changes = new Set<Parameters<SessionPort['subscribe']>[0]>()
    let who: typeof ann | undefined = ann
    const switching: SessionPort = {
      ...session,
      current: () => who,
      subscribe: (onChange) => {
        changes.add(onChange)

        return () => changes.delete(onChange)
      },
    }
    const services = fakeServices(switching)
    const frame = openedFrame()
    const spoken: string[] = []
    const router = createAppRouter({
      modules: [HomeModule],
      session: switching,
      layout: () => (
        <NoticeProvider>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    frame.actor.on('speak', ({ locale }) => spoken.push(locale))
    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ShellFrameContext.Provider value={frame}>
          <ServicesProvider services={services}>
            <RouterProvider router={router} />
          </ServicesProvider>
        </ShellFrameContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    act(() => {
      services.runner.set(settingsShape, [{ id: settingsIdFactory.create(), locale: 'es' }])
    })

    await waitFor(() => expect(spoken).toEqual(['es']))

    // Signed out, the settings read for Ann are not this device's any more: nothing to speak.
    act(() => {
      who = undefined

      for (const onChange of changes) {
        onChange(undefined)
      }
    })

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.locale-select').hasAttribute('data-disabled')).toBe(
        false,
      ),
    )
    expect(spoken).toEqual(['es'])
  })
})
