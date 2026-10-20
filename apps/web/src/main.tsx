import '@workspace/ui/styles/global.css'

import { Outlet, RouterProvider } from '@tanstack/react-router'
import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'

import { matchLocale } from '@workspace/i18n'

import type { AppServices } from './composition/root'
import { ShellContainer } from './features/app-shell/presentation/shell/shell.container'
import { ShellView } from './features/app-shell/presentation/shell/shell.view'
import { modules } from './modules'
import { englishCatalog, loadSpanishCatalog } from './platform/catalogs'
import { AppI18n, useSetLocale } from './platform/i18n'
import { NoticeProvider } from './platform/notices'
import { createAppRouter } from './platform/router'
import { ServicesProvider } from './platform/services'

type Boot =
  | { readonly status: 'opening' | 'failed' | 'storage-blocked' }
  | {
      readonly status: 'ready'
      readonly services: AppServices
      readonly router: ReturnType<typeof createAppRouter>
    }

function Layout() {
  return (
    <NoticeProvider>
      <ShellContainer>
        <Outlet />
      </ShellContainer>
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
          router: createAppRouter({ modules, session: services.session, layout: Layout }),
        }),
        (failure) => ({
          status: failure.kind === 'storage-blocked' ? 'storage-blocked' : 'failed',
        }),
      ),
    )
    // A start that throws (its code did not load) failed too: it does not open any more.
    .catch((): Boot => ({ status: 'failed' }))

  return booting
}

function App() {
  const [boot, setBoot] = useState<Boot>({ status: 'opening' })
  const setLocale = useSetLocale()

  useEffect(() => {
    let mounted = true

    void bootOnce().then((next) => {
      if (mounted) {
        setBoot(next)
      }
    })

    return () => {
      mounted = false
    }
  }, [])

  if (boot.status !== 'ready') {
    return (
      <ShellView
        status={boot.status}
        signedIn={false}
        activePath={window.location.pathname}
        onLocaleChange={setLocale}
      />
    )
  }

  return (
    <ServicesProvider services={boot.services}>
      <RouterProvider router={boot.router} />
    </ServicesProvider>
  )
}

const root = document.getElementById('root')

if (root) {
  createRoot(root).render(
    <StrictMode>
      <AppI18n
        initial={matchLocale(navigator.language)}
        en={englishCatalog}
        loadEs={loadSpanishCatalog}
      >
        <App />
      </AppI18n>
    </StrictMode>,
  )
}
