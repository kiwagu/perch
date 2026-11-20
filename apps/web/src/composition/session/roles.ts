/**
 * The session's side of the account's platform roles (`operator`) on this device: the roles of
 * the identity this tab shows, read from the record of the sign-in current on the browser while
 * it is that identity's. Only a welcome writes a record (`apply`), heard by the tab that leads the
 * browser's sync while the sign-in it welcomed is still the one saved on the browser; the other
 * tabs follow it through the storage (`followSaved`), reading and writing nothing. A console
 * request the gateway refused as `not-operator` drops the role from the record of the sign-in
 * that asked (`drop`), whichever sign-in is current by then. The ending of a sign-in removes its
 * record (`forgetSignIn`).
 */

import type { IdentityId } from '@workspace/ids'
import type { PlatformRole } from '@workspace/kernel'

import {
  dropRole,
  type KeptSession,
  type KeyValueStorage,
  type SignInOwner,
  savedRoles,
  savedSession,
  saveRoles,
} from '../storage'

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
   * The roles of the identity shown, read from the record of the sign-in current on the browser
   * while it is that identity's (another identity's is never read): none while nobody is shown.
   * The same set while they stay the same.
   */
  current(): ReadonlySet<PlatformRole> {
    const shown = this.#options.shown()
    const current = savedSession(this.#options.storage)
    const read =
      shown !== undefined && current?.identity === shown
        ? savedRoles(this.#options.storage, current)
        : []
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
   * A welcome of the sign-in `session` carried `roles`: they are kept in its record, in place of
   * those kept before, while it is still the sign-in saved on the browser, and the subscribers
   * told. A welcome landing after its sign-out, or after another sign-in, writes nothing.
   */
  apply(session: KeptSession, roles: readonly PlatformRole[]): void {
    if (savedSession(this.#options.storage)?.signIn !== session.signIn) {
      return
    }

    saveRoles(this.#options.storage, session, roles)
    this.tell()
  }

  /**
   * The gateway refused the sign-in `asker` a request for want of `role`: the role goes from that
   * sign-in's record, as the request captured it when it started, whichever sign-in is current
   * now (a later one of the same account keeps what its own welcome brought); a sign-in without
   * a record, its own ended already, gets none.
   */
  drop(asker: SignInOwner, role: PlatformRole): void {
    dropRole(this.#options.storage, asker, role)
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
