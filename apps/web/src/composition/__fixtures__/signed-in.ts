/**
 * A sign-in and a sign-out as they leave the browser's storage, written by this tab or by another
 * one the test does not open, for specs to start from or to race with.
 */

import type { AuthUser } from '@workspace/data'
import type { Membership } from '@workspace/replica/protocol'

import {
  forgetSignIn,
  type KeptSession,
  type KeyValueStorage,
  type MemoryStorage,
  newSignInId,
  saveDevice,
  savedSession,
} from '../storage'

/** A device a sign-in made whole: who it is, its session token, and the memberships it read (none by default). */
export interface DeviceSignedIn {
  readonly identity: AuthUser
  readonly token: string
  readonly memberships?: readonly Membership[]
}

/** Saves `device` as a new sign-in on this browser, as a sign-in leaves it; answers its session. */
export function signedIn(storage: KeyValueStorage, device: DeviceSignedIn): KeptSession {
  const signIn = newSignInId()

  saveDevice(storage, signIn, { ...device, memberships: device.memberships ?? [] })

  return { signIn, identity: device.identity.id, token: device.token }
}

/** Ends the sign-in `storage` sees saved now, if any, as a sign-out made there leaves the storage. */
export function signedOut(storage: KeyValueStorage): void {
  const seen = savedSession(storage)

  if (seen) {
    forgetSignIn(storage, seen.signIn)
  }
}

/**
 * The storage as another tab of the browser writes it: each write it makes is heard by this tab
 * at once, one key at a time, and one that changes nothing is heard by nobody, as in a browser.
 */
export function elsewhere(storage: MemoryStorage): KeyValueStorage {
  return {
    get: (key) => storage.get(key),
    set: (key, value) => {
      if (storage.get(key) !== value) {
        storage.changeElsewhere(key, value)
      }
    },
    remove: (key) => {
      if (storage.get(key) !== undefined) {
        storage.changeElsewhere(key, undefined)
      }
    },
    onChangeElsewhere: () => () => {},
  }
}

/** Another tab signs `device` in; this tab hears it key by key. Answers the new sign-in's session. */
export function signedInElsewhere(storage: MemoryStorage, device: DeviceSignedIn): KeptSession {
  return signedIn(elsewhere(storage), device)
}

/** Another tab signs out the sign-in this tab sees saved; this tab hears its records go. */
export function signedOutElsewhere(storage: MemoryStorage): void {
  signedOut(elsewhere(storage))
}
