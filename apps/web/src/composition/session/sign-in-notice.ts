import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'
import { dropNotice, forgetNotice, type KeyValueStorage, savedNotice } from '../storage'

/** Where `word` stands in the rank of `SESSION_NOTICES`. */
const standing = (word: SessionNotice): number => SESSION_NOTICES.indexOf(word)

/**
 * The word this tab's sign-in page says, from two slots. The browser's (`perch.session.notice`)
 * holds what a session left as it ended, for whichever tab opens the sign-in page next. This tab's
 * own holds what a screen of this tab showed there on its way (a fact of this tab's move, never
 * the browser's), in memory for the page's lifetime, so another tab's sign-in page cannot take it,
 * and a later write of the browser's slot cannot replace it. Each slot keeps the first by the rank
 * of `SESSION_NOTICES` of the words written to it. The page decides as it reads: of the two words
 * it says the first by that rank, and it takes both. A sign-in on this device drops both unsaid.
 */
export class SignInNotice {
  readonly #storage: KeyValueStorage
  #own: SessionNotice | undefined

  constructor(storage: KeyValueStorage) {
    this.#storage = storage
  }

  /** Keeps `notice` as this tab's own, unless the word it keeps comes first by the rank. */
  leave(notice: SessionNotice): void {
    if (this.#own === undefined || standing(notice) < standing(this.#own)) {
      this.#own = notice
    }
  }

  /** The word the sign-in page says now. */
  read(): SessionNotice | undefined {
    const own = this.#own
    const browsers = savedNotice(this.#storage)

    return SESSION_NOTICES.find((word) => word === own || word === browsers)
  }

  /** Takes both words away: the sign-in page said them. */
  take(): void {
    this.#own = undefined
    forgetNotice(this.#storage)
  }

  /**
   * Drops both words unsaid: an account signed in on this device, which a flow says by clearing
   * the page's notice. A word raised before it and written later goes too (`dropNotice`).
   */
  drop(): void {
    this.#own = undefined
    dropNotice(this.#storage)
  }
}
