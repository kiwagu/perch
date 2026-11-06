import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'

import type { KeyValueStorage } from './key-value'

/** Moves at each sign-in on this browser (`markSignIn`): a word raised before it is gone. */
const SIGN_INS_KEY = 'perch.session.sign-ins'

/**
 * The key of `notice` left after the sign-in `mark`: each sign-in's words have keys of their own,
 * so a late write of an older one never replaces a newer one.
 */
const wordKey = (mark: string, notice: SessionNotice): string =>
  `perch.session.notice.${mark}.${notice}`

/** The last sign-in on this browser, which a word raised now comes after: `0` before the first. */
export function signInMark(storage: KeyValueStorage): string {
  return storage.get(SIGN_INS_KEY) ?? '0'
}

/**
 * Leaves the sign-in page a word about how the last session ended, raised after the sign-in
 * `raised` (the `signInMark` as the session ended; now by default). A word raised before the last
 * sign-in on this browser is not written: that sign-in ended it. Every word of every sign-in has
 * a key of its own, so no write replaces another: one that races a sign-in names the sign-in
 * before, which the page no longer reads (`savedNotice`).
 */
export function saveNotice(
  storage: KeyValueStorage,
  notice: SessionNotice,
  raised: string = signInMark(storage),
): void {
  if (raised === signInMark(storage)) {
    storage.set(wordKey(raised, notice), notice)
  }
}

/**
 * The word the sign-in page says of those the sessions left since the last sign-in on this
 * browser: the first by the rank of `SESSION_NOTICES`. A kept value it does not know is none.
 */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const since = signInMark(storage)

  return SESSION_NOTICES.find((notice) => storage.get(wordKey(since, notice)) === notice)
}

/** Takes the words away: the sign-in page said them. */
export function forgetNotice(storage: KeyValueStorage): void {
  forgetWords(storage, signInMark(storage))
}

/**
 * An account signed in on this browser, as its session is kept: every word raised before goes,
 * and one raised before but written later is not said. The words of the sign-in that ends go,
 * those a write racing the sign-in before it left, and any a count it does not know left under
 * the next one, then the mark moves.
 */
export function markSignIn(storage: KeyValueStorage): void {
  const mark = signInMark(storage)
  const count = Number.parseInt(mark, 10)
  const known = Number.isSafeInteger(count)
  const next = String(known ? count + 1 : 1)

  for (const ended of known ? [mark, String(count - 1), next] : [mark, next]) {
    forgetWords(storage, ended)
  }

  storage.set(SIGN_INS_KEY, next)
}

function forgetWords(storage: KeyValueStorage, mark: string): void {
  for (const notice of SESSION_NOTICES) {
    storage.remove(wordKey(mark, notice))
  }
}
