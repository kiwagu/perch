import { err, ok, type Result } from 'neverthrow'

import { type DataError, dataError } from '@workspace/data'

/** The part of `window` that hands out the page's localStorage. */
export interface SiteStorageSource {
  readonly localStorage: Storage | null
}

const PROBE_KEY = 'perch.storage.probe'

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

    store.setItem(PROBE_KEY, PROBE_KEY)

    const kept = store.getItem(PROBE_KEY) === PROBE_KEY

    store.removeItem(PROBE_KEY)

    return kept ? ok(store) : err(blocked())
  } catch (cause: unknown) {
    return err(blocked(cause))
  }
}
