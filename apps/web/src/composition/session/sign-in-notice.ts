import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'
import { forgetNotice, type KeyValueStorage, savedNotice, signInMark } from '../storage'

/** This tab's own word, with the sign-in on this browser it was left after (`signInMark`). */
interface Own {
  readonly notice: SessionNotice
  readonly raised: string
}

/** Where `word` stands in the rank of `SESSION_NOTICES`. */
const standing = (word: SessionNotice): number => SESSION_NOTICES.indexOf(word)

/**
 * The word this tab's sign-in page says, from two slots. The browser's (`perch.session.notice.*`)
 * holds what a session left as it ended, for whichever tab opens the sign-in page next. This tab's
 * own holds what a screen of this tab showed there on its way (a fact of this tab's move, never
 * the browser's), in memory for the page's lifetime, so another tab's sign-in page cannot take it,
 * and a later write of the browser's slot cannot replace it. A word waits from the session that
 * raised it until the page says it or an account signs in on this browser: each slot holds the
 * words left since the last sign-in, and the page says the first of them by the rank of
 * `SESSION_NOTICES`, and takes them all.
 */
export class SignInNotice {
  readonly #storage: KeyValueStorage
  #own: Own | undefined

  constructor(storage: KeyValueStorage) {
    this.#storage = storage
  }

  /** Keeps `notice` as this tab's own, unless a word it left since the last sign-in comes first. */
  leave(notice: SessionNotice): void {
    const raised = signInMark(this.#storage)
    const own = this.#current()

    if (own === undefined || standing(notice) < standing(own)) {
      this.#own = { notice, raised }
    }
  }

  /** The word the sign-in page says now. */
  read(): SessionNotice | undefined {
    const own = this.#current()
    const browsers = savedNotice(this.#storage)

    return SESSION_NOTICES.find((word) => word === own || word === browsers)
  }

  /** Takes both words away: the sign-in page said them. */
  take(): void {
    this.#own = undefined
    forgetNotice(this.#storage)
  }

  /**
   * A sign-in on this browser was heard, maybe late (a tab that follows one opens its data first):
   * this tab's own word left before it goes. The browser's went as the sign-in was kept
   * (`markSignIn`), and a word a later session left since stays: hearing it late ends nothing newer.
   */
  drop(): void {
    if (this.#current() === undefined) {
      this.#own = undefined
    }
  }

  /** This tab's own word, while no account signed in on this browser after it was left. */
  #current(): SessionNotice | undefined {
    return this.#own?.raised === signInMark(this.#storage) ? this.#own.notice : undefined
  }
}
