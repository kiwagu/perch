/**
 * Boots the application in a browser. Each signed-in identity has its own database, run by
 * an engine in a Web Worker on IndexedDB; the gateway is reached on this page's own origin
 * under `/backend/`; one tab per browser leads an identity's sync through a Web Lock and the
 * tabs hint each other over a BroadcastChannel. `<html data-boot-step>` shows where a start
 * stopped; `data-sync-leader` and `data-sync-channel` show the tab's sync role and channel.
 */

import { err, ok, type Result } from 'neverthrow'

import { deleteLocalDb, openLocalDb, tenantDatabase } from '@workspace/data'
import { wasmEngines } from '@workspace/data/engines/wasm'
import { createLogger } from '@workspace/logger/client'
import { systemClock } from '@workspace/replica'
import type { DeviceNetwork } from '@workspace/replica/sync'
import { lockName, syncHints } from '@workspace/replica/sync'

import type { Theme } from '../platform/theme'

import { accountsApi } from './accounts-api'
import { browserClipboard } from './browser-clipboard'
import { openOneAtATime } from './database-open-lock'
import { deviceLabel } from './device-label'
import { devicesApi } from './devices-api'
import { warmEngines } from './engine-warm'
import { gatewayAuth } from './gateway-auth'
import type { SyncState, Visibility } from './identity-space'
import { invitationsApi } from './invitations-api'
import { organisationsApi } from './organisations-api'
import { type AppStart, type BootFailure, createAppRoot } from './root'
import { servedBuild } from './served-build'
import type { VisibilitySource } from './session'
import { siteStorage } from './site-storage'
import { spaceCode } from './space-code'
import { browserStorage } from './storage'
import { syncTransport } from './sync-transport'
import build from 'virtual:perch-build'

const commonFiles = import.meta.glob<string>('../../../../database/schema/common/*.surql', {
  eager: true,
  import: 'default',
})
const directoryFiles = import.meta.glob<string>('../../../../database/schema/directory/*.surql', {
  eager: true,
  import: 'default',
})
const tenantFiles = import.meta.glob<string>('../../../../database/schema/tenant/*.surql', {
  eager: true,
  import: 'default',
})

/** One database's schema: the common files, then its own, each set in name order. */
const schemaOf = (...sets: ReadonlyArray<Readonly<Record<string, string>>>): string =>
  sets
    .flatMap((files) =>
      Object.keys(files)
        .sort()
        .map((path) => files[path]),
    )
    .join('\n')

const directorySchema = schemaOf(commonFiles, directoryFiles)
const tenantSchema = schemaOf(commonFiles, tenantFiles)

/** Where the database of one identity lives in this browser. */
const identityUrl = (identity: string): string => `indxdb://app-identity-${identity}`

/** Where the database of one organisation of an identity lives in this browser. */
const tenantUrl = (identity: string, key: string): string =>
  `${identityUrl(identity)}-${tenantDatabase(key)}`

function documentVisibility(page: Document): VisibilitySource {
  const current = (): Visibility => (page.visibilityState === 'hidden' ? 'hidden' : 'visible')

  return {
    current,
    onChange: (listener) => {
      const handler = () => listener(current())

      page.addEventListener('visibilitychange', handler)

      return () => page.removeEventListener('visibilitychange', handler)
    },
  }
}

/** The start in a browser: the app's, and the warm-up of the engines a guest's sign-in opens. */
export interface BrowserStart extends AppStart {
  /** Loads the engines a sign-in opens ahead of it; for a guest, once the sign-in page is up. */
  readonly warm: () => void
}

/**
 * Boots the app; `theme` is the theme this device shows now, as the page's start made it. The
 * start itself fails only when the browser keeps no site data; the open of the saved account's
 * data says later whether it failed.
 */
export function bootBrowser(
  theme: () => Theme,
): Result<BrowserStart, Extract<BootFailure, { readonly kind: 'storage-blocked' }>> {
  const store = siteStorage(window)

  // Without site storage nothing is kept: neither who is signed in nor the device's own id.
  if (store.isErr()) {
    return err({ kind: 'storage-blocked', error: store.error })
  }

  const html = document.documentElement
  const logger = createLogger('web')
  const showSync = (state: SyncState): void => {
    html.dataset['syncLeader'] = state.leader ? '1' : '0'
    html.dataset['syncChannel'] = state.channel
  }
  const origin = window.location.origin
  // Undefined in a page that is not a secure context: such a page does not sync, and says so.
  const locks: LockManager | undefined = navigator.locks
  const visibility = documentVisibility(document)
  // The browser's network: the sync status reads it in every tab, and the leading tab's channel
  // hears it come back to connect again at once.
  const network: DeviceNetwork = {
    online: () => navigator.onLine,
    onOnlineChange: (listener) => {
      window.addEventListener('online', listener)
      window.addEventListener('offline', listener)

      return () => {
        window.removeEventListener('online', listener)
        window.removeEventListener('offline', listener)
      }
    },
  }

  showSync({ leader: false, channel: 'down' })

  return ok({
    ...createAppRoot({
      // One tab at a time opens a database: two engines setting up a new one at once conflict.
      openLocal: (identity) =>
        openOneAtATime(locks, identityUrl(identity), () =>
          openLocalDb({
            engines: wasmEngines(),
            url: identityUrl(identity),
            namespace: 'app',
            database: 'identity',
            schema: directorySchema,
          }),
        ),
      openTenantLocal: (identity, key) =>
        openOneAtATime(locks, tenantUrl(identity, key), () =>
          openLocalDb({
            engines: wasmEngines(),
            url: tenantUrl(identity, key),
            namespace: 'app',
            database: 'tenant',
            schema: tenantSchema,
          }),
        ),
      deleteLocal: (identity) => deleteLocalDb(identityUrl(identity)),
      deleteTenantLocal: (identity, key) => deleteLocalDb(tenantUrl(identity, key)),
      gatewayAuth: gatewayAuth(`${origin}/backend`),
      deviceLabel: deviceLabel(navigator),
      theme,
      online: network.online,
      onOnlineChange: network.onOnlineChange,
      organisationsApi: (deps) => organisationsApi(`${origin}/backend`, deps),
      devicesApi: (deps) => devicesApi(`${origin}/backend`, deps),
      invitationsApi: (deps) => invitationsApi(`${origin}/backend`, deps),
      accountsApi: (deps) => accountsApi(`${origin}/backend`, deps),
      // Undefined in a page that is not a secure context: a copy then fails and says so.
      clipboard: browserClipboard(navigator.clipboard),
      transport: syncTransport({
        url: `${origin.replace(/^http/, 'ws')}/backend/sync`,
        clock: systemClock,
        network,
      }),
      locks,
      hints: (identity) => syncHints(new BroadcastChannel(lockName(identity))),
      clock: systemClock,
      storage: browserStorage(store.value, window),
      visibility,
      servedBuild: servedBuild({
        running: build,
        fetcher: (url, init) => fetch(url, init),
        visibility,
        clock: systemClock,
      }),
      logger: {
        info: (fields) => logger.info(fields, 'command'),
        warn: (fields) => logger.warn(fields, 'command'),
      },
      logEvents: import.meta.env.DEV,
      onStep: (step) => {
        html.dataset['bootStep'] = step
      },
      // An error is logged by its code and message: its cause, whatever raised it, may carry a
      // session token in its text.
      onError: (error) => logger.error({ code: error.code }, error.message),
      onSyncState: showSync,
    }),
    warm: () => warmEngines(window, spaceCode),
  })
}
