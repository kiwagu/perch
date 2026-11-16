// @vitest-environment jsdom
import { createMemoryHistory, Outlet, RouterProvider } from '@tanstack/react-router'
import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { I18nProvider, type Locale } from '@workspace/i18n'
import { identityIdFactory, settingsIdFactory } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'
import { Input } from '@workspace/ui/components/ui/input'
import { UnsavedInputScope } from '@workspace/ui/unsaved-input'

import { memoryInstall } from '../../../../platform/__fixtures__/install'
import { fakeServices, fakeSession } from '../../../../platform/__fixtures__/session'
import { memoryTheme } from '../../../../platform/__fixtures__/theme'
import en from '../../../../platform/i18n/app.en.json'
import es from '../../../../platform/i18n/app.es.json'
import { InstallContext } from '../../../../platform/install'
import { defineModule } from '../../../../platform/module'
import { NoticeProvider } from '../../../../platform/notices'
import { createAppRouter } from '../../../../platform/router'
import { ServicesProvider } from '../../../../platform/services'
import type { SessionPort } from '../../../../platform/session.port'
import { ThemeContext } from '../../../../platform/theme'
import { settingsShape } from '../../../user/application/settings/settings.model.gen'
import { FRAME_STATES } from '../../application/shell-machine'
import { CrashSignal } from '../crash/crash-signal'
import { LeaveGuard } from '../leave-guard/leave-guard.container'

import { openedFrame, openingFrame } from './__fixtures__/frame'
import { NOTICE_TEXTS } from './notice-texts'
import { ShellContainer } from './shell.container'
import { ShellFrameContext } from './shell-frame'

/** The roles of a page anyone opens, a guest or any signed-in account. */
const ANYONE = ['guest', 'identity']

const HomeModule = defineModule({
  id: 'home',
  declarations: { Home: () => <p>home</p> },
  routes: [{ path: '/home', page: 'Home', roles: ANYONE }],
})

const FormModule = defineModule({
  id: 'form',
  declarations: { Form: () => <Input aria-label="name" defaultValue="" /> },
  routes: [{ path: '/form', page: 'Form', roles: ANYONE }],
})

const BrokenModule = defineModule({
  id: 'broken',
  declarations: {
    Broken: () => {
      throw new Error('the page broke')
    },
  },
  routes: [{ path: '/broken', page: 'Broken', roles: ANYONE }],
})

/**
 * A page at the console's address for an operator alone, beside the not-found page every account
 * opens: the frame names and marks the screen the router resolved, not the address.
 */
const OperatorsModule = defineModule({
  id: 'operators',
  declarations: { Console: () => <p>the operator's page</p>, Lost: () => <p>no page here</p> },
  routes: [
    { path: '/console/users', page: 'Console', roles: ['operator'] },
    { path: '/$', page: 'Lost', roles: ['guest', 'identity', 'member', 'admin'] },
  ],
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame()}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )

    const message = await screen.findByTestId('app-shell.crash-message')

    expect(message.getAttribute('data-code')).toBe('screen-crashed')
    expect(screen.getByTestId('app-shell.reload-button').hasAttribute('disabled')).toBe(false)
    // The guest's frame stays around it, with no navigation.
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()
    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
    quiet.mockRestore()
  })

  it('shows a guest no navigation, and an account its navigation from its sign-in to its sign-out', async () => {
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const listeners = new Set<(user: typeof ann | undefined) => void>()
    let current: typeof ann | undefined
    const { session: guest } = fakeSession()
    const session: SessionPort = {
      ...guest,
      current: () => current,
      subscribe: (listener) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
    }
    const account = (user: typeof ann | undefined) => {
      current = user
      for (const listener of listeners) {
        listener(user)
      }
    }
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame()}>
              <ServicesProvider services={fakeServices(session)}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
    expect(screen.getByTestId('app-shell.locale-select')).toBeTruthy()

    act(() => account(ann))

    expect(screen.getByTestId('app-shell.nav.profile-link')).toBeTruthy()
    expect(screen.getByTestId('app-shell.nav.settings-link')).toBeTruthy()

    act(() => account(undefined))

    expect(screen.queryByTestId('app-shell.nav')).toBeNull()
  })

  it("names and marks a page its roles refuse as the not-found page, and follows the account's roles while open", async () => {
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const { session: guest } = fakeSession()
    let roles: ReadonlySet<PlatformRole> = new Set()
    const listeners = new Set<(next: ReadonlySet<PlatformRole>) => void>()
    const session: SessionPort = {
      ...guest,
      current: () => ann,
      roles: () => roles,
      onRoles: (listener) => {
        listeners.add(listener)

        return () => {
          listeners.delete(listener)
        }
      },
    }
    // The account's roles read anew, as a welcome or another tab brings them.
    const grant = (next: readonly PlatformRole[]) => {
      roles = new Set(next)

      for (const listener of listeners) {
        listener(roles)
      }
    }
    const router = createAppRouter({
      modules: [OperatorsModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          <ShellContainer>
            <Outlet />
          </ShellContainer>
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: ['/console/users'] }),
    })
    const notFoundTitle = en['app.title.page'].replace('{title}', en['app.title.not-found'])
    // The links of the navigation marked current.
    const current = () =>
      screen
        .getAllByRole('link')
        .filter((link) => link.getAttribute('aria-current') === 'page')
        .map((link) => link.getAttribute('data-testid'))

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame()}>
              <ServicesProvider services={fakeServices(session)}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )

    await screen.findByText('no page here')
    await waitFor(() => expect(document.title).toBe(notFoundTitle))
    expect(screen.queryByTestId('app-shell.nav.console-link')).toBeNull()
    expect(current()).toEqual([])

    act(() => grant(['operator']))

    await screen.findByText("the operator's page")
    await waitFor(() => expect(document.title).not.toBe(notFoundTitle))
    expect(current()).toEqual(['app-shell.nav.console-link'])

    act(() => grant([]))

    await screen.findByText('no page here')
    await waitFor(() => expect(document.title).toBe(notFoundTitle))
    expect(screen.queryByTestId('app-shell.nav.console-link')).toBeNull()
    expect(current()).toEqual([])
    expect(router.state.location.href).toBe('/console/users')
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame()}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
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

  it('shows a signed-in account no language or theme select: its settings screen takes the choice', async () => {
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame()}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')
    act(() => {
      services.runner.set(settingsShape, [
        { id: settingsIdFactory.create(), locale: 'en', theme: 'system' },
      ])
    })

    expect(screen.getByTestId('app-shell.nav.settings-link')).toBeTruthy()
    expect(screen.queryByTestId('app-shell.locale-select')).toBeNull()
    expect(screen.queryByTestId('app-shell.theme-select')).toBeNull()
  })

  it("applies the account's stored language and theme once its data opened, and ones stored elsewhere at once", async () => {
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const { session: guest } = fakeSession()
    const session: SessionPort = { ...guest, current: () => ann }
    const services = fakeServices(session)
    const theme = memoryTheme()
    const frame = openingFrame(ann.id, { setTheme: theme.set })
    const spoken: string[] = []
    const id = settingsIdFactory.create()
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

    frame.actor.on('speak', ({ locale }) => spoken.push(locale))
    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={theme}>
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    // The settings read while the data still opens: the frame takes them once it is open.
    act(() => {
      services.runner.set(settingsShape, [{ id, locale: 'es', theme: 'dark' }])
    })

    expect(theme.current()).toBe('system')
    expect(spoken).toEqual([])

    act(() => {
      frame.actor.send({ type: 'platform.opened' })
    })

    await waitFor(() => expect(theme.current()).toBe('dark'))
    expect(spoken).toEqual(['es'])

    // Another tab or device stores another theme: it shows at once, the language staying.
    act(() => {
      services.runner.set(settingsShape, [{ id, locale: 'es', theme: 'light' }])
    })

    await waitFor(() => expect(theme.current()).toBe('light'))
    expect(spoken).toEqual(['es'])
  })

  it('applies a language and a theme stored elsewhere while the install prompt is pending, at once', async () => {
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const { session: guest } = fakeSession()
    const session: SessionPort = { ...guest, current: () => ann }
    const services = fakeServices(session)
    const theme = memoryTheme()
    let endPrompt = () => {}
    const frame = openedFrame({
      setTheme: theme.set,
      install: {
        prompt: () =>
          new Promise<void>((resolve) => {
            endPrompt = resolve
          }),
        postpone: () => {},
      },
    })
    const spoken: string[] = []
    const id = settingsIdFactory.create()
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

    frame.actor.on('speak', ({ locale }) => spoken.push(locale))
    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={theme}>
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    act(() => {
      services.runner.set(settingsShape, [{ id, locale: 'en', theme: 'light' }])
    })

    await waitFor(() => expect(theme.current()).toBe('light'))
    expect(spoken).toEqual(['en'])

    // The browser's install prompt is up; another tab or device stores another language and theme.
    act(() => {
      frame.actor.send({ type: 'app-shell.install-button' })
    })
    act(() => {
      services.runner.set(settingsShape, [{ id, locale: 'es', theme: 'dark' }])
    })

    // The frame hears them in the install window, before the prompt is answered.
    await waitFor(() => expect(theme.current()).toBe('dark'))
    expect(frame.actor.getSnapshot().matches(FRAME_STATES.installing)).toBe(true)
    expect(spoken).toEqual(['en', 'es'])

    await act(async () => {
      endPrompt()
    })

    await waitFor(() => expect(frame.actor.getSnapshot().matches(FRAME_STATES.offering)).toBe(true))
    expect(theme.current()).toBe('dark')
    expect(spoken).toEqual(['en', 'es'])
  })

  it('shows the state of the sync while the install prompt is pending', async () => {
    const { session } = fakeSession()
    const services = fakeServices(session)
    let endPrompt = () => {}
    const frame = openedFrame({
      install: {
        prompt: () =>
          new Promise<void>((resolve) => {
            endPrompt = resolve
          }),
        postpone: () => {},
      },
    })
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    act(() => services.sync('synced'))
    await screen.findByTestId('app-shell.sync-message')

    // The browser's install window is up; the sync goes offline while it stays open.
    act(() => {
      frame.actor.send({ type: 'app-shell.install-button' })
    })
    act(() => services.sync('offline'))

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.sync-message').getAttribute('data-code')).toBe(
        'offline',
      ),
    )
    expect(frame.actor.getSnapshot().matches(FRAME_STATES.installing)).toBe(true)

    await act(async () => {
      endPrompt()
    })
  })

  it("lets a guest choose the device's theme from the frame, and shows one chosen elsewhere at once", async () => {
    const { session } = fakeSession()
    const services = fakeServices(session)
    const theme = memoryTheme('dark')
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
        <ThemeContext.Provider value={theme}>
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={openedFrame({ setTheme: theme.set })}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
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

    // Something else shows another theme on the device.
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
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    act(() => {
      services.runner.set(settingsShape, [
        { id: settingsIdFactory.create(), locale: 'es', theme: 'system' },
      ])
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

  it("takes an account's notice away when another account replaces it before a render", async () => {
    const { session } = fakeSession()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const bob = { id: identityIdFactory.create(), email: 'bob@example.test' }
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
    const sent = vi.spyOn(frame.actor, 'send')
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

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <InstallContext.Provider value={memoryInstall()}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')
    await act(() =>
      services.reject({
        region: 'tenant:acme',
        batch: 1,
        reason: 'forbidden-action',
        detail: 'note/nte_1:update',
        reloaded: false,
      }),
    )
    await screen.findByTestId('app-shell.notice-message')
    act(() => services.sync('synced'))
    await screen.findByTestId('app-shell.sync-message')

    // Ann signs out and Bob signs in before the frame renders again: the session tells both, the
    // render sees Bob alone, whose sync gives no state yet.
    act(() => {
      services.sync(undefined)

      for (const next of [undefined, bob]) {
        who = next

        for (const onChange of changes) {
          onChange(next)
        }
      }
    })

    await waitFor(() => {
      expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()
      expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()
    })
    expect(sent.mock.calls.filter(([event]) => event.type === 'platform.signed-out')).toHaveLength(
      1,
    )
  })

  /**
   * The shell for a guest, in a frame that loads the page again through `reload`: on /home, or
   * `guarded` on /form with a field, inside the kit's unsaved-input scope and the frame's leave
   * guard as the start mounts them; `refusedBefore` when the session heard the gateway refuse
   * the protocol before the shell mounted.
   */
  async function homeShell(
    options: { readonly guarded?: boolean; readonly refusedBefore?: boolean } = {},
  ) {
    const reload = vi.fn()
    const install = memoryInstall()
    const { session: guest } = fakeSession()
    const session: SessionPort = { ...guest, protocolRefused: () => options.refusedBefore === true }
    const services = fakeServices(session)
    const frame = openedFrame({ reload, install })
    const shell = (
      <ShellContainer>
        <Outlet />
      </ShellContainer>
    )
    const router = createAppRouter({
      modules: [HomeModule, FormModule],
      session,
      layout: () => (
        <NoticeProvider texts={NOTICE_TEXTS}>
          {options.guarded ? (
            <UnsavedInputScope>
              <LeaveGuard>{shell}</LeaveGuard>
            </UnsavedInputScope>
          ) : (
            shell
          )}
        </NoticeProvider>
      ),
      history: createMemoryHistory({ initialEntries: [options.guarded ? '/form' : '/home'] }),
    })

    render(
      <I18nProvider locale="en" catalogs={{ en, es }}>
        <ThemeContext.Provider value={memoryTheme()}>
          <InstallContext.Provider value={install}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByTestId('app-shell.locale-select')

    return { services, frame, reload, install }
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

  it('says a protocol the gateway refused before the shell listened', async () => {
    await homeShell({ refusedBefore: true })

    expect((await screen.findByTestId('app-shell.update-message')).getAttribute('data-code')).toBe(
      'protocol-outdated',
    )
  })

  it('never loads the page again by itself while a field holds unsaved input, and its button asks first', async () => {
    const { services, reload } = await homeShell({ guarded: true })

    try {
      await userEvent.type(screen.getByLabelText('name'), 'Ann')
      act(() => services.serveNewer('0.2.0+2b9a0c1d'))
      await screen.findByTestId('app-shell.update-message')
      showTab('hidden')
      showTab('visible')

      expect(reload).not.toHaveBeenCalled()

      // The button asks before the reload loses what was typed: staying keeps the page.
      await userEvent.click(screen.getByTestId('app-shell.update-button'))
      await userEvent.click(await screen.findByTestId('app-shell.leave-dialog.cancel-button'))

      expect(reload).not.toHaveBeenCalled()

      await userEvent.click(screen.getByTestId('app-shell.update-button'))
      await userEvent.click(await screen.findByTestId('app-shell.leave-dialog.confirm-button'))

      await waitFor(() => expect(reload).toHaveBeenCalledOnce())
    } finally {
      showTab('visible')
    }
  })

  it('says the state of the sync the platform gives, and takes it away with the account', async () => {
    const { services, frame } = await homeShell()

    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()

    act(() => services.sync('connecting'))

    expect((await screen.findByTestId('app-shell.sync-message')).getAttribute('data-code')).toBe(
      'connecting',
    )

    act(() => services.sync('synced'))

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.sync-message').getAttribute('data-code')).toBe('synced'),
    )

    // Signed out, the session gives no state any more and the frame's flow clears it.
    act(() => {
      services.sync(undefined)
      frame.actor.send({ type: 'platform.signed-out' })
    })

    await waitFor(() => expect(screen.queryByTestId('app-shell.sync-message')).toBeNull())
  })

  it("shows a signed-in account's screen while its data opens, and the platform's messages once open", async () => {
    const install = memoryInstall()
    const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
    const { session: guest } = fakeSession()
    const session: SessionPort = { ...guest, current: () => ann }
    const services = fakeServices(session)
    const frame = openingFrame(ann.id, { install })
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
          <InstallContext.Provider value={install}>
            <ShellFrameContext.Provider value={frame}>
              <ServicesProvider services={services}>
                <RouterProvider router={router} />
              </ServicesProvider>
            </ShellFrameContext.Provider>
          </InstallContext.Provider>
        </ThemeContext.Provider>
      </I18nProvider>,
    )
    await screen.findByText('home')

    expect(screen.getByTestId('app-shell.status').getAttribute('data-state')).toBe('opening-data')
    expect(screen.getByTestId('app-shell.nav.profile-link')).toBeTruthy()

    act(() => {
      install.offer('install-offered')
      services.sync('synced')
    })

    expect(screen.queryByTestId('app-shell.install-message')).toBeNull()
    expect(screen.queryByTestId('app-shell.sync-message')).toBeNull()

    act(() => {
      frame.actor.send({ type: 'platform.opened' })
    })

    await waitFor(() =>
      expect(screen.getByTestId('app-shell.status').getAttribute('data-state')).toBe('ready'),
    )
    expect((await screen.findByTestId('app-shell.install-message')).getAttribute('data-code')).toBe(
      'install-available',
    )
    expect(screen.getByTestId('app-shell.sync-message').getAttribute('data-code')).toBe('synced')

    act(() => services.serveNewer('0.2.0+2b9a0c1d'))

    expect((await screen.findByTestId('app-shell.update-message')).getAttribute('data-code')).toBe(
      'new-version',
    )
  })

  it("reminds to install the app at the browser's offer, puts it off, and installs it", async () => {
    const { install } = await homeShell()

    expect(screen.queryByTestId('app-shell.install-message')).toBeNull()

    act(() => install.offer('install-offered'))

    expect((await screen.findByTestId('app-shell.install-message')).getAttribute('data-code')).toBe(
      'install-available',
    )

    await userEvent.click(screen.getByTestId('app-shell.install-later-button'))

    await waitFor(() => expect(screen.queryByTestId('app-shell.install-message')).toBeNull())
    expect(install.postponed()).toBe(1)

    act(() => install.offer('install-offered'))
    await userEvent.click(await screen.findByTestId('app-shell.install-button'))

    await waitFor(() => expect(screen.queryByTestId('app-shell.install-message')).toBeNull())
    expect(install.prompted()).toBe(1)
  })
})
