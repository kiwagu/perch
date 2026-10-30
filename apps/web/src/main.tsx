import '@workspace/ui/styles/global.css'

import { Outlet, RouterProvider } from '@tanstack/react-router'
import { useMachine } from '@xstate/react'
import { StrictMode, useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { matchLocale } from '@workspace/i18n'
import { UnsavedInputScope } from '@workspace/ui/unsaved-input'

import type { AppServices, BootFailure } from './composition/root'
import { LocaleWrites } from './features/app-shell/application/locale-writes'
import { ConfirmGuard } from './features/app-shell/presentation/confirm-guard/confirm-guard.container'
import { CrashSignal } from './features/app-shell/presentation/crash/crash-signal'
import { LeaveGuard } from './features/app-shell/presentation/leave-guard/leave-guard.container'
import { NOTICE_TEXTS } from './features/app-shell/presentation/shell/notice-texts'
import { ShellContainer } from './features/app-shell/presentation/shell/shell.container'
import { ShellView } from './features/app-shell/presentation/shell/shell.view'
import {
  frameLanguageWrites,
  ShellFrameContext,
  type ShellLive,
  shellFrameMachine,
} from './features/app-shell/presentation/shell/shell-frame'
import { TOAST_TEXTS } from './features/app-shell/presentation/shell/toast-texts'
import { modules } from './modules'
import { englishCatalog, loadSpanishCatalog } from './platform/catalogs'
import { AppI18n, useSetLocale } from './platform/i18n'
import { LanguageWritesContext } from './platform/language-writes'
import { NoticeProvider } from './platform/notices'
import { createAppRouter } from './platform/router'
import { ServicesProvider } from './platform/services'
import { browserTheme, ThemeContext } from './platform/theme'
import { ToastProvider } from './platform/toasts'
import { installUiHelper } from './platform/ui-contract'

type Boot =
  | { readonly status: 'opening' | 'storage-blocked' }
  | {
      readonly status: 'failed'
      /** Signs the saved account out on this device, when its data is what did not open. */
      readonly signOutHere?: Extract<BootFailure, { kind: 'open-failed' }>['signOutHere']
    }
  | {
      readonly status: 'ready'
      readonly services: AppServices
      readonly router: ReturnType<typeof createAppRouter>
    }

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
  // The database code and its WASM engine load after the first frame, so the
  // shell paints without waiting for them; nothing opens until someone is signed in.
  booting ??= import('./composition/browser')
    .then(({ bootBrowser }) => bootBrowser())
    .then((result) =>
      result.match<Boot>(
        (services) => ({
          status: 'ready',
          services,
          router: createAppRouter({
            modules,
            session: services.session,
            layout: Layout,
            crash: CrashSignal,
          }),
        }),
        (failure) =>
          failure.kind === 'storage-blocked'
            ? { status: 'storage-blocked' }
            : { status: 'failed', signOutHere: failure.signOutHere },
      ),
    )
    // A start that throws (its code did not load) failed too: it does not open any more.
    .catch((): Boot => ({ status: 'failed' }))

  return booting
}

/** The frame's state before the router renders it: where the start is. */
const STATUS = {
  opening: 'opening',
  failed: 'failed',
  'signing-out': 'failed',
  'signed-out': 'failed',
  'storage-blocked': 'storage-blocked',
} as const

function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'opening' })
  const setLocale = useSetLocale()
  // The frame's flow runs from the start: what it reads is filled in as the start and the shell learn it.
  const [made] = useState(() => {
    const live: ShellLive = {
      account: undefined,
      stored: undefined,
      writes: LocaleWrites.none,
      generation: 0,
      signOutHere: undefined,
      renderAgain: undefined,
    }

    return { live, machine: shellFrameMachine(live) }
  })
  const [state, send, actor] = useMachine(made.machine)
  const frame = useMemo(() => ({ actor, live: made.live }), [actor, made])
  // The settings screen's stores of the language, kept by the frame to tell their echo from another device's.
  const languageWrites = useMemo(() => frameLanguageWrites(made.live), [made])

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

    void bootOnce().then((next) => {
      if (mounted) {
        made.live.signOutHere = next.status === 'failed' ? next.signOutHere : undefined
        setBoot(next)
        send({
          type:
            next.status === 'ready'
              ? 'platform.opened'
              : next.status === 'failed'
                ? 'platform.open-failed'
                : 'platform.storage-blocked',
        })
      }
    })

    return () => {
      mounted = false
    }
  }, [made, send])

  if (boot.status !== 'ready') {
    // Until the start is ready the machine has not opened the frame: it is in one of these states.
    const status = STATUS[state.value as keyof typeof STATUS]

    return (
      <ShellView
        status={status}
        signedIn={false}
        activePath={window.location.pathname}
        canChooseLocale={state.can({ type: 'app-shell.locale-select', locale: 'en' })}
        onLocaleChange={(locale) => send({ type: 'app-shell.locale-select', locale })}
        onSignOutHere={
          boot.status === 'failed' && boot.signOutHere
            ? () => send({ type: 'app-shell.sign-out-here-button' })
            : undefined
        }
        signingOutHere={!state.can({ type: 'app-shell.sign-out-here-button' })}
      />
    )
  }

  return (
    <ShellFrameContext.Provider value={frame}>
      <LanguageWritesContext.Provider value={languageWrites}>
        <ServicesProvider services={boot.services}>
          <RouterProvider router={boot.router} />
        </ServicesProvider>
      </LanguageWritesContext.Provider>
    </ShellFrameContext.Provider>
  )
}

// Development and e2e builds only: `window.__perch.ui.anchors()` for tests and agents.
if (__PERCH_UI_HOOKS__) {
  installUiHelper(window)
}

// The theme this device kept shows before the first frame.
const theme = browserTheme()
const root = document.getElementById('root')

if (root) {
  createRoot(root).render(
    <StrictMode>
      <ThemeContext.Provider value={theme}>
        <AppI18n
          initial={matchLocale(navigator.language)}
          en={englishCatalog}
          loadEs={loadSpanishCatalog}
        >
          <App />
        </AppI18n>
      </ThemeContext.Provider>
    </StrictMode>,
  )
}
