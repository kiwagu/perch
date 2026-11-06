import '@workspace/ui/styles/global.css'

import { Outlet, RouterProvider } from '@tanstack/react-router'
import { useMachine } from '@xstate/react'
import type { ResultAsync } from 'neverthrow'
import { StrictMode, useCallback, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { matchLocale } from '@workspace/i18n'
import { UnsavedInputScope } from '@workspace/ui/unsaved-input'

import type { AppServices, BootFailure } from './composition/root'
import { serviceWorkerReload } from './composition/service-worker'
import { NOTHING_SEEN } from './features/app-shell/application/setting-writes'
import { ConfirmGuard } from './features/app-shell/presentation/confirm-guard/confirm-guard.container'
import { CrashSignal } from './features/app-shell/presentation/crash/crash-signal'
import { LeaveGuard } from './features/app-shell/presentation/leave-guard/leave-guard.container'
import { NOTICE_TEXTS } from './features/app-shell/presentation/shell/notice-texts'
import { ShellContainer } from './features/app-shell/presentation/shell/shell.container'
import {
  frameSettingsWrites,
  ShellFrameContext,
  type ShellLive,
  shellFrameMachine,
} from './features/app-shell/presentation/shell/shell-frame'
import { ShellView } from './features/app-shell/presentation/shell/shell-view'
import { useSignedOutUnrouted } from './features/app-shell/presentation/shell/signed-out-unrouted'
import { TOAST_TEXTS } from './features/app-shell/presentation/shell/toast-texts'
import { modules } from './modules'
import { englishCatalog, loadSpanishCatalog } from './platform/catalogs'
import { AppI18n, useSetLocale } from './platform/i18n'
import { browserInstall, InstallContext, useDeviceInstall } from './platform/install'
import { NoticeProvider } from './platform/notices'
import { PLATFORM_EVENTS } from './platform/platform-events.port'
import { sendPlatformEvents } from './platform/platform-events-input'
import { createAppRouter } from './platform/router'
import { rendersIn } from './platform/screen-renders'
import { ServicesProvider } from './platform/services'
import { SettingsWritesContext } from './platform/settings-writes'
import { useSettledReport } from './platform/settled-report'
import { browserTheme, ThemeContext, useDeviceTheme } from './platform/theme'
import { ToastProvider } from './platform/toasts'
import { installUiHelper } from './platform/ui-contract'

/** Signs the saved account out on this device, when its data is what did not open. */
type SignOutHere = Extract<BootFailure, { kind: 'open-failed' }>['signOutHere']

/** What the start made of the page: the services and the router, which render at once. */
interface Started {
  readonly services: AppServices
  readonly router: ReturnType<typeof createAppRouter>
  /** Loads the engines a sign-in opens ahead of it. */
  readonly warm: () => void
}

/**
 * How the start ended: started, with the open of the saved account's data still going on;
 * stopped because the browser keeps no site data; or failed to start, its code not loaded or run.
 */
type Boot =
  | ({ readonly status: 'started'; readonly opened: ResultAsync<void, BootFailure> } & Started)
  | { readonly status: 'storage-blocked' | 'start-failed' }

function Layout() {
  return (
    <NoticeProvider texts={NOTICE_TEXTS}>
      <ToastProvider texts={TOAST_TEXTS}>
        <UnsavedInputScope>
          <LeaveGuard>
            <ConfirmGuard>
              <ShellContainer>
                <Outlet />
              </ShellContainer>
            </ConfirmGuard>
          </LeaveGuard>
        </UnsavedInputScope>
      </ToastProvider>
    </NoticeProvider>
  )
}

// One page boots once. A second boot, such as React re-running effects in
// development, would open the signed-in identity's space twice in one tab: two
// engines on its database and two claims on the sync lead.
let booting: Promise<Boot> | undefined

function bootOnce(): Promise<Boot> {
  // The database code loads after the first frame, so the shell paints without waiting for it;
  // its WASM engines load only when a space opens, so nothing loads them until someone is signed in.
  booting ??= import('./composition/browser')
    .then(({ bootBrowser }) =>
      bootBrowser(() => theme.current()).match<Boot>(
        ({ services, opened, warm }) => ({
          status: 'started',
          services,
          opened,
          warm,
          router: createAppRouter({
            modules,
            session: services.session,
            layout: Layout,
            crash: CrashSignal,
          }),
        }),
        () => ({ status: 'storage-blocked' }),
      ),
    )
    // A start that throws, its code not loaded or run, failed to start: it opens nothing more.
    .catch((): Boot => ({ status: 'start-failed' }))

  return booting
}

/** The frame's states with no screen rendered, and the status each shows. */
const STATUS = {
  opening: 'opening',
  failed: 'failed',
  'signing-out': 'failed',
  'signed-out': 'failed',
  'start-failed': 'start-failed',
  'storage-blocked': 'storage-blocked',
} as const

function App(props: { readonly reload: () => void }) {
  const [started, setStarted] = useState<Started | undefined>(undefined)
  const [signOutHere, setSignOutHere] = useState<SignOutHere>(undefined)
  const setLocale = useSetLocale()
  const device = useDeviceTheme()
  const install = useDeviceInstall()
  // The frame's flow runs from the start: what it reads is filled in as the start and the shell learn it.
  const [made] = useState(() => {
    const live: ShellLive = {
      account: undefined,
      stored: undefined,
      writes: NOTHING_SEEN,
      generation: 0,
      signOutHere: undefined,
      renderAgain: undefined,
      unsaved: false,
    }

    return {
      live,
      machine: shellFrameMachine(live, {
        setTheme: device.set,
        followTheme: device.follow,
        install,
        reload: props.reload,
      }),
    }
  })
  const [state, send, actor] = useMachine(made.machine)
  const frame = useMemo(() => ({ actor, live: made.live }), [actor, made])
  // The account the frame shows, as the start and then the shell's container last saw it.
  const shownAccount = useCallback(() => made.live.account, [made])

  // Development and e2e builds report each state of the frame the page settles in.
  useSettledReport('app-shell', state.value, () => actor.getSnapshot().value)
  // The settings screen's stores, kept by the frame to tell their echo from another tab's or device's.
  const settingsWrites = useMemo(() => frameSettingsWrites(made.live), [made])

  useEffect(() => {
    const spoken = actor.on('speak', ({ locale }) => setLocale(locale))
    // Done or not, a sign-out here leaves the account signed out on this device: the page starts
    // again on sign-in, and what could not be deleted yet goes at that start.
    const moved = actor.on('navigate', ({ to }) => window.location.assign(to))

    return () => {
      spoken.unsubscribe()
      moved.unsubscribe()
    }
  }, [actor, setLocale])

  useEffect(() => {
    let mounted = true

    void bootOnce().then((boot) => {
      if (!mounted) {
        return
      }

      if (boot.status !== 'started') {
        send({
          type:
            boot.status === 'start-failed' ? 'platform.start-failed' : 'platform.storage-blocked',
        })

        return
      }

      // The frame and the screen render at once: a guest's at once ready, a signed-in account's
      // while its data opens, which the frame hears when it ends.
      made.live.account = boot.services.session.current()?.id
      setStarted({ services: boot.services, router: boot.router, warm: boot.warm })
      send({ type: 'platform.started' })
      void boot.opened.match(
        () => {
          if (mounted) {
            send({ type: 'platform.opened' })
          }
        },
        (failure) => {
          if (mounted) {
            const out = failure.kind === 'open-failed' ? failure.signOutHere : undefined

            made.live.signOutHere = out
            setSignOutHere(() => out)
            send({ type: 'platform.open-failed' })
          }
        },
      )
    })

    return () => {
      mounted = false
    }
  }, [made, send])

  // The facts another tab of this browser sets reach the frame's flow once the services exist,
  // in every state, as they reach a screen's.
  useEffect(
    () =>
      started === undefined
        ? undefined
        : sendPlatformEvents(started.services.container.get(PLATFORM_EVENTS), actor),
    [started, actor],
  )

  // A guest's sign-in opens the engines: they load once the frame and its page are up, so they
  // never compete with them.
  useEffect(() => {
    if (started !== undefined && made.live.account === undefined) {
      started.warm()
    }
  }, [started, made])

  // The states with no screen: the start goes on, stopped or failed, or the data did not open.
  const unrouted: (typeof STATUS)[keyof typeof STATUS] | undefined =
    STATUS[state.value as keyof typeof STATUS]

  useSignedOutUnrouted(started?.services.session, actor, unrouted !== undefined, shownAccount)

  if (started === undefined || unrouted !== undefined) {
    return (
      <ShellView
        status={unrouted ?? 'opening'}
        renders={rendersIn(made.machine.config, state.value)}
        signedIn={false}
        activePath={window.location.pathname}
        canChooseLocale={state.can({ type: 'app-shell.locale-select', locale: 'en' })}
        onLocaleChange={(locale) => send({ type: 'app-shell.locale-select', locale })}
        theme={device.theme}
        canChooseTheme={state.can({ type: 'app-shell.theme-select', theme: 'light' })}
        onThemeChange={(theme) => send({ type: 'app-shell.theme-select', theme })}
        onSignOutHere={
          signOutHere ? () => send({ type: 'app-shell.sign-out-here-button' }) : undefined
        }
        signingOutHere={!state.can({ type: 'app-shell.sign-out-here-button' })}
      />
    )
  }

  return (
    <ShellFrameContext.Provider value={frame}>
      <SettingsWritesContext.Provider value={settingsWrites}>
        <ServicesProvider services={started.services}>
          <RouterProvider router={started.router} />
        </ServicesProvider>
      </SettingsWritesContext.Provider>
    </ShellFrameContext.Provider>
  )
}

// Development and e2e builds only: `window.__perch.ui.anchors()` for tests and agents.
if (__PERCH_UI_HOOKS__) {
  installUiHelper(window)
}

// The theme this device kept shows before the first frame.
const theme = browserTheme()
// Heard from the start, so an offer to install the browser makes early reaches the reminder.
const install = browserInstall()
// Production builds register the service worker, which opens the app offline; the frame's reload
// then lets a waiting newer worker take over first.
const reload = import.meta.env.PROD ? serviceWorkerReload(window) : () => window.location.reload()
const root = document.getElementById('root')

if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeContext.Provider value={theme}>
        <InstallContext.Provider value={install}>
          <AppI18n
            initial={matchLocale(navigator.language)}
            en={englishCatalog}
            loadEs={loadSpanishCatalog}
          >
            <App reload={reload} />
          </AppI18n>
        </InstallContext.Provider>
      </ThemeContext.Provider>
    </StrictMode>,
  )
}
