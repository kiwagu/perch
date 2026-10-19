/**
 * Boots the application in a browser. Each signed-in identity has its own database, run by
 * an engine in a Web Worker on IndexedDB; the gateway is reached on this page's own origin
 * under `/backend/`; one tab per browser leads an identity's sync through a Web Lock and the
 * tabs hint each other over a BroadcastChannel. `<html data-boot-step>` shows where a start
 * stopped; `data-sync-leader` and `data-sync-channel` show the tab's sync role and channel.
 */

import type { ResultAsync } from 'neverthrow'

import { type DataError, deleteLocalDb, openLocalDb, tenantDatabase } from '@workspace/data'
import { wasmEngines } from '@workspace/data/engines/wasm'
import { createLogger } from '@workspace/logger/client'
import { systemClock } from '@workspace/replica'
import { lockName, syncHints, WebSocketTransport } from '@workspace/replica/sync'

import { deviceLabel } from './device-label'
import { devicesApi } from './devices-api'
import { gatewayAuth } from './gateway-auth'
import type { SyncState, Visibility } from './identity-space'
import { organisationsApi } from './organisations-api'
import { type AppServices, createAppRoot } from './root'
import type { VisibilitySource } from './session-options'
import { browserStorage } from './storage'

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

/** Where the database of one organisation of an identity lives in this browser. */
const tenantUrl = (identity: string, key: string): string =>
  `indxdb://app-identity-${identity}-${tenantDatabase(key)}`

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

export function bootBrowser(): ResultAsync<AppServices, DataError> {
  const html = document.documentElement
  const logger = createLogger('web')
  const showSync = (state: SyncState): void => {
    html.dataset['syncLeader'] = state.leader ? '1' : '0'
    html.dataset['syncChannel'] = state.channel
  }
  const origin = window.location.origin
  // Undefined in a page that is not a secure context: such a page does not sync, and says so.
  const locks: LockManager | undefined = navigator.locks

  showSync({ leader: false, channel: 'down' })

  return createAppRoot({
    openLocal: (identity) =>
      openLocalDb({
        engines: wasmEngines(),
        url: `indxdb://app-identity-${identity}`,
        namespace: 'app',
        database: 'identity',
        schema: directorySchema,
      }),
    openTenantLocal: (identity, key) =>
      openLocalDb({
        engines: wasmEngines(),
        url: tenantUrl(identity, key),
        namespace: 'app',
        database: 'tenant',
        schema: tenantSchema,
      }),
    deleteTenantLocal: (identity, key) => deleteLocalDb(tenantUrl(identity, key)),
    gatewayAuth: gatewayAuth(`${origin}/backend`),
    deviceLabel: deviceLabel(navigator),
    online: () => navigator.onLine,
    organisationsApi: (deps) => organisationsApi(`${origin}/backend`, deps),
    devicesApi: (deps) => devicesApi(`${origin}/backend`, deps),
    transport: (context) =>
      new WebSocketTransport({
        url: `${origin.replace(/^http/, 'ws')}/backend/sync`,
        device: context.device,
        credentials: context.credentials,
        onTokens: context.onTokens,
        onMemberships: context.onMemberships,
        onEnded: context.onEnded,
        clock: systemClock,
      }),
    locks,
    hints: (identity) => syncHints(new BroadcastChannel(lockName(identity))),
    clock: systemClock,
    storage: browserStorage(window.localStorage, window),
    visibility: documentVisibility(document),
    logger: {
      info: (fields) => logger.info(fields, 'command'),
      warn: (fields) => logger.warn(fields, 'command'),
    },
    onStep: (step) => {
      html.dataset['bootStep'] = step
    },
    onError: (error) =>
      logger.error({ code: error.code, cause: String(error.cause) }, error.message),
    onSyncState: showSync,
  })
}
