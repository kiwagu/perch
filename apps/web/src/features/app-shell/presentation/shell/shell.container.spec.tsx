// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider, type Locale } from '@workspace/i18n'
import { identityIdFactory, settingsIdFactory } from '@workspace/ids'

import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import { memoryTheme } from '../../../../platform/__fixtures__/theme'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { defineModule } from '../../../../platform/module'
import { NoticeProvider } from '../../../../platform/notices'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'
import type { SessionPort } from '../../../../platform/session.port'
import { ThemeContext } from '../../../../platform/theme'
import { settingsShape } from '../../../user/application/settings/settings.model.gen'
import { CrashSignal } from '../crash/crash-signal'

import { openedFrame } from './__fixtures__/frame'
import { NOTICE_TEXTS } from './notice-texts'
import { ShellContainer } from './shell.container'
import { ShellFrameContext } from './shell-frame'

const HomeModule = defineModule({
  id: 'home',
  declarations: { Home: () => <p>home</p> },
  routes: [{ path: '/home', page: 'Home' }],
})

const BrokenModule = defineModule({
  id: 'broken',
  declarations: {
    Broken: () => {
      throw new Error('the page broke')
    },
  },
  routes: [{ path: '/broken', page: 'Broken' }],
})

describe('ShellContainer', () => {
  it('says a page that fails to render on arrival in its place, with the reload', async () => {
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => {})
    const { session } = fakeSession()
    const services = fakeServices(session)
    const router = createAppRouter({
      modules: [BrokenModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/broken'] }),
      crash: CrashSignal,
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={openedFrame()}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )

    const message = await screen.findByTestId('app-shell.crash-message')

    expect(message.getAttribute('data-code')).toBe('screen-crashed')
    expect(screen.getByTestId('app-shell.reload-button').hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('app-shell.nav')).toBeTruthy()
    quiet.mockRestore()
  })

  it('tells the user of a change the gateway refused and this device undid', async () => {
    const { session } = fakeSession()
    const services = fakeServices(session)
    const { reject } = services
    const router = createAppRouter({
      modules: [HomeModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={openedFrame()}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()

    await act(() =>
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
    await act(() =>
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

  it('says a notice in the language the app speaks now, not the one it spoke when raised', async () => {
    const { session } = fakeSession()
    const services = fakeServices(session)
    const { reject } = services
    const frame = openedFrame()
    const router = createAppRouter({
      modules: [HomeModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })
    const app = (locale: Locale) => (
      <I18nProvider locale={locale} catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={frame}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>
    )
    const view = render(app('es'))

    await screen.findByText('home')
    await act(() =>
      reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
        reloaded: false,
      }),
    )

    expect((await screen.findByTestId('app-shell.notice-message')).textContent).toBe(
      es['app.shell.rejected'],
    )

    view.rerender(app('en'))

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.notice-message').textContent).toBe(
        en['app.shell.rejected'],
      ),
    )
  })

  it('shows a signed-in account no language select: its settings screen takes the choice', async () => {
    const { session } = fakeSession()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const signedIn: SessionPort = { ...session, current: () => ann }
    const services = fakeServices(signedIn)
    const router = createAppRouter({
      modules: [HomeModule],
      session: signedIn,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={openedFrame()}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')
    act(() => {
      services.runner.set(settingsShape, [{ id: settingsIdFactory.create(), locale: 'en' }])
    })

    expect(screen.getByTestId('app-shell.nav.settings-link')).toBeTruthy()
    expect(screen.queryByTestId('app-shell.locale-select')).toBeNull()
  })

  it("chooses the device's theme from the frame, and shows one chosen elsewhere at once", async () => {
    const { session } = fakeSession()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const signedIn: SessionPort = { ...session, current: () => ann }
    const services = fakeServices(signedIn)
    const theme = memoryTheme('dark')
    const router = createAppRouter({
      modules: [HomeModule],
      session: signedIn,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={theme}>
          <ShellFrameContext.Provider value={openedFrame({ setTheme: theme.set })}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    const select = screen.getByTestId('app-shell.theme-select')

    expect(select.getAttribute('data-value')).toBe('dark')

    await userEvent.click(select)

    const light = await screen.findByRole('option', { name: en['app.shell.theme.light'] })

    // The list takes no pointer until it has finished opening.
    await vi.waitFor(() => expect(getComputedStyle(light).pointerEvents).not.toBe('none'))
    await userEvent.click(light)

    expect(theme.current()).toBe('light')
    await waitFor(() => expect(select.getAttribute('data-value')).toBe('light'))

    // The settings screen chooses the same device theme.
    act(() => theme.set('system'))

    expect(select.getAttribute('data-value')).toBe('system')
  })

  it("speaks no signed-out account's stored language, and its notice goes with it", async () => {
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
    const { reject } = services
    const frame = openedFrame()
    const spoken: string[] = []
    const router = createAppRouter({
      modules: [HomeModule],
      session: switching,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
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
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={frame}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    act(() => {
      services.runner.set(settingsShape, [{ id: settingsIdFactory.create(), locale: 'es' }])
    })

    await waitFor(() => expect(spoken).toEqual(['es']))

    await act(() =>
      reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
        reloaded: false,
      }),
    )
    await screen.findByTestId('app-shell.notice-message')

    // Signed out, the settings read for Ann are not this device's any more: nothing to speak,
    // and the notice raised for her goes too.
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
    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()
  })

  /** The shell on /home for a guest, in a frame that loads the page again through `reload`. */
  async function homeShell(reload = vi.fn()) {
    const { session } = fakeSession()
    const services = fakeServices(session)
    const frame = openedFrame({ reload })
    const router = createAppRouter({
      modules: [HomeModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <ShellFrameContext.Provider value={frame}>
            <ServicesProvider services={services}>
              <RouterProvider router={router} />
            </ServicesProvider>
          </ShellFrameContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    return { services, frame, reload }
  }

  /** The browser sends the tab to the background, or back to the front. */
  function showTab(state: 'hidden' | 'visible') {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
  }

  it('says a newer build the server serves, and its button loads the page again', async () => {
    const { services, reload } = await homeShell()

    expect(screen.queryByTestId('app-shell.update-message')).toBeNull()

    act(() => services.serveNewer('0.2.0+2b9a0c1d'))

    const message = await screen.findByTestId('app-shell.update-message')

    expect(message.getAttribute('data-code')).toBe('new-version')

    await userEvent.click(screen.getByTestId('app-shell.update-button'))

    await waitFor(() => expect(reload).toHaveBeenCalledOnce())
  })

  it('says a protocol the server no longer takes', async () => {
    const { services } = await homeShell()

    await act(() => services.refuseProtocol())

    expect((await screen.findByTestId('app-shell.update-message')).getAttribute('data-code')).toBe(
      'protocol-outdated',
    )
    expect(screen.getByTestId('app-shell.update-button').hasAttribute('disabled')).toBe(false)
  })

  it('loads the page again by itself when the tab goes to the background with an update waiting', async () => {
    const { services, reload } = await homeShell()

    try {
      // Nothing waits: the tab goes and comes back as it is.
      showTab('hidden')
      showTab('visible')

      expect(reload).not.toHaveBeenCalled()

      act(() => services.serveNewer('0.2.0+2b9a0c1d'))
      await screen.findByTestId('app-shell.update-message')
      showTab('hidden')

      await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    } finally {
      showTab('visible')
    }
  })
})
