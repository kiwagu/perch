import type { IdentityId } from '@workspace/ids'

import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'
import { forgetNotice, type KeyValueStorage, savedNotice } from '../storage'

/** This tab's own word, with the account signed in here when it was left (none for a guest). */
interface Own {
  readonly notice: SessionNotice
  readonly identity: IdentityId | undefined
}

/**
 * The word this tab's sign-in page says, from two slots. The browser's (`perch.session.notice`)
 * holds what a session left as it ended, for whichever tab opens the sign-in page next. This tab's
 * own holds what a screen of this tab showed there on its way (a fact of this tab's move, never
 * the browser's), in memory for the page's lifetime, so another tab's sign-in page cannot take it,
 * and a later write of the browser's slot cannot replace it; a sign-in of another account in this
 * tab drops it. The page decides as it reads: of the two words it says the first by their rank
 * (`SESSION_NOTICES`), and it takes both.
 */
export class SignInNotice {
  readonly #storage: KeyValueStorage
  #own: Own | undefined

  constructor(storage: KeyValueStorage) {
    this.#storage = storage
  }

  /** Keeps `notice` as this tab's own, for the account signed in here now (`identity`). */
  leave(notice: SessionNotice, identity: IdentityId | undefined): void {
    this.#own = { notice, identity }
  }

  /** An account signed in in this tab: this tab's own word goes unless it was left for that one. */
  signedIn(identity: IdentityId): void {
    if (this.#own !== undefined && this.#own.identity !== identity) {
      this.#own = undefined
    }
  }

  /** The word the sign-in page says now. */
  read(): SessionNotice | undefined {
    const own = this.#own?.notice
    const browsers = savedNotice(this.#storage)

    return SESSION_NOTICES.find((word) => word === own || word === browsers)
  }

  /** Takes both words away: the sign-in page said them. */
  take(): void {
    this.#own = undefined
    forgetNotice(this.#storage)
  }
}
