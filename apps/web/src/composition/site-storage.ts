import { err, ok, type Result } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

/** The part of `window` that hands out the page's localStorage. */
export interface SiteStorageSource {
  readonly localStorage: Storage | null
}

/** Each probe writes a key of its own: another tab probing at the same moment removes only its own. */
const probeKey = (): string => `perch.storage.probe.${crypto.randomUUID()}`

const blocked = (cause?: unknown) =>
  dataError('data:OPEN_FAILED', 'this browser keeps no site data for this page', cause)

/**
 * The page's localStorage, once it has kept a value and handed it back. A browser that blocks
 * site data throws on reading it, gives none, or throws on (or drops) every write: the app
 * cannot keep who is signed in or the device's own id, so it does not start rather than
 * forget them silently.
 */
export function siteStorage(source: SiteStorageSource): Result<Storage, DataError> {
  try {
    const store = source.localStorage

    if (!store) {
      return err(blocked())
    }

    const key = probeKey()

    store.setItem(key, key)

    const kept = store.getItem(key) === key

    store.removeItem(key)

    return kept ? ok(store) : err(blocked())
  } catch (cause: unknown) {
    return err(blocked(cause))
  }
}
