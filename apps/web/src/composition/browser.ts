/**
 * Boots the application in a browser: the database runs in a Web Worker on
 * IndexedDB, the session token lives in localStorage, and the boot step is shown
 * on <html data-boot-step> so a start that hangs names where it stopped.
 */

import type { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'
import { wasmEngines } from '@workspace/data/engines/wasm'
import { createLogger } from '@workspace/logger/client'

import { type AppServices, createAppRoot } from './root'
import { browserStorage } from './storage'

const schemaFiles = import.meta.glob<string>('../../../../database/schema/*.surql', {
  eager: true,
  import: 'default',
})

const schema = Object.keys(schemaFiles)
  .sort()
  .map((path) => schemaFiles[path])
  .join('\n')

export function bootBrowser(): ResultAsync<AppServices, DataError> {
  const html = document.documentElement
  const logger = createLogger('web')

  // One device, no server yet: this tab leads and only the local direction exists.
  html.dataset['syncLeader'] = '1'
  html.dataset['syncChannel'] = 'down'

  return createAppRoot({
    engines: wasmEngines(),
    url: 'indxdb://perch',
    schema,
    storage: browserStorage(window.localStorage),
    onStep: (step) => {
      html.dataset['bootStep'] = step
    },
    onError: (error) =>
      logger.error({ code: error.code, cause: String(error.cause) }, error.message),
  })
}
