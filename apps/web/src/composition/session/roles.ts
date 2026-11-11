/**
 * The session's side of the account's platform roles (`operator`) on this device: the roles of
 * the identity this tab shows, read from that identity's own record in the browser's storage.
 * Only a welcome writes a record (`apply`), heard by the tab that leads the browser's sync while
 * the identity it welcomed is still the one signed in on the browser; the other tabs follow it
 * through the storage (`followSaved`), reading and writing nothing. A console request the gateway
 * refused as `not-operator` drops the role from the record of the identity that asked (`drop`),
 * whichever identity is shown by then. The sign-out removes the record (`forgetDevice`).
 */

import type { IdentityId } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import { dropRole, type KeyValueStorage, savedIdentity, savedRoles, saveRoles } from '../storage'

export interface SessionRolesOptions {
  readonly storage: KeyValueStorage
  /** The identity this tab shows now (its space open, or opening at the start), if any. */
  readonly shown: () => IdentityId | undefined
}

export class SessionRoles {
  readonly #options: SessionRolesOptions
  readonly #listeners = new Set<(roles: ReadonlySet<PlatformRole>) => void>()
  /** The roles read last: given again while a read finds the same ones. */
  #held: ReadonlySet<PlatformRole> = new Set()

  constructor(options: SessionRolesOptions) {
    this.#options = options
  }

  /**
   * The roles of the identity shown, read from its own record (another identity's is never
   * read): none while nobody is shown. The same set while they stay the same.
   */
  current(): ReadonlySet<PlatformRole> {
    const shown = this.#options.shown()
    const read = shown === undefined ? [] : savedRoles(this.#options.storage, shown)
    const held = this.#held

    if (read.length !== held.size || read.some((role) => !held.has(role))) {
      this.#held = new Set(read)
    }

    return this.#held
  }

  /** Hears the roles read anew: a welcome, another tab's record, a change of identity, a drop. */
  subscribe(listener: (roles: ReadonlySet<PlatformRole>) => void): () => void {
    this.#listeners.add(listener)

    return () => this.#listeners.delete(listener)
  }

  /**
   * A welcome of `identity` carried `roles`: they are kept in its record, in place of those kept
   * before, while it is still the identity signed in on the browser, and the subscribers told.
   * A welcome landing after a sign-out or another account's sign-in writes nothing.
   */
  apply(identity: IdentityId, roles: readonly PlatformRole[]): void {
    if (savedIdentity(this.#options.storage)?.id !== identity) {
      return
    }

    saveRoles(this.#options.storage, identity, roles)
    this.tell()
  }

  /**
   * The gateway refused `identity` a request for want of `role`: the role goes from that
   * identity's record, whichever identity is shown now; an identity without a record gets none.
   */
  drop(identity: IdentityId, role: PlatformRole): void {
    dropRole(this.#options.storage, identity, role)
    this.tell()
  }

  /** Another tab saved or removed a record: the roles are read anew and told; nothing is written. */
  followSaved(): void {
    this.tell()
  }

  /** The identity shown may have changed: reads its record anew and tells the subscribers. */
  tell(): void {
    const roles = this.current()

    for (const listener of this.#listeners) {
      listener(roles)
    }
  }
}
