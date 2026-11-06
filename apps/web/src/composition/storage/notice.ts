import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'

import type { KeyValueStorage } from './key-value'

/** Moves at each sign-in on this browser (`markSignIn`): a word raised before it is gone. */
const SIGN_INS_KEY = 'perch.session.sign-ins'

/** The key of a word left for the sign-in page; its value names the sign-in it came after. */
const wordKey = (notice: SessionNotice): string => `perch.session.notice.${notice}`

/** The last sign-in on this browser, which a word raised now comes after: `0` before the first. */
export function signInMark(storage: KeyValueStorage): string {
  return storage.get(SIGN_INS_KEY) ?? '0'
}

/**
 * Leaves the sign-in page a word about how the last session ended, raised after the sign-in
 * `raised` (the `signInMark` as the session ended; now by default). A word raised before the last
 * sign-in on this browser is not written: that sign-in ended it. Each word has a key of its own
 * naming that sign-in, so a write that loses a race with a sign-in, or with another word of
 * another tab, is told apart as the page reads (`savedNotice`), never by what it overwrote.
 */
export function saveNotice(
  storage: KeyValueStorage,
  notice: SessionNotice,
  raised: string = signInMark(storage),
): void {
  if (raised === signInMark(storage)) {
    storage.set(wordKey(notice), raised)
  }
}

/**
 * The word the sign-in page says of those the sessions left since the last sign-in on this
 * browser: the first by the rank of `SESSION_NOTICES`. A kept value naming another sign-in is none.
 */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const since = signInMark(storage)

  return SESSION_NOTICES.find((notice) => storage.get(wordKey(notice)) === since)
}

/** Takes the words away: the sign-in page said them. */
export function forgetNotice(storage: KeyValueStorage): void {
  for (const notice of SESSION_NOTICES) {
    storage.remove(wordKey(notice))
  }
}

/**
 * An account signed in on this browser, as its session is kept: every word raised before goes,
 * and one raised before but written later is not said. The words go first, then the mark moves,
 * so a write racing with it still names the sign-in before.
 */
export function markSignIn(storage: KeyValueStorage): void {
  const count = Number.parseInt(signInMark(storage), 10)

  forgetNotice(storage)
  storage.set(SIGN_INS_KEY, String(Number.isSafeInteger(count) ? count + 1 : 1))
}
