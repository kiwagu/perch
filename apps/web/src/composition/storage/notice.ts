import { z } from '@workspace/zod'

import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'

import type { KeyValueStorage } from './key-value'

const NOTICE_KEY = 'perch.session.notice'

/** Moves each time a flow drops the word (`dropNotice`): a sign-in on this browser. */
const DROPPED_KEY = 'perch.session.notice-dropped'

const sessionNotice = z.enum(SESSION_NOTICES)

/** Which drop of the word (`dropNotice`) a word raised now comes after: `0` before the first. */
export function noticeMark(storage: KeyValueStorage): string {
  return storage.get(DROPPED_KEY) ?? '0'
}

/**
 * Leaves the sign-in page a word about how the last session ended, raised at `raised` (the
 * `noticeMark` then; now by default). A word raised before a flow dropped the words since is not
 * written: it went with that drop. Of the words of one ending, the first by the rank of
 * `SESSION_NOTICES` stays, whichever is written last: at most one session ends between two
 * sign-ins, and a sign-in drops them.
 */
export function saveNotice(
  storage: KeyValueStorage,
  notice: SessionNotice,
  raised: string = noticeMark(storage),
): void {
  if (noticeMark(storage) !== raised) {
    return
  }

  const saved = savedNotice(storage)

  if (saved === undefined || SESSION_NOTICES.indexOf(notice) < SESSION_NOTICES.indexOf(saved)) {
    storage.set(NOTICE_KEY, notice)
  }
}

/** The word the last session left for the sign-in page; a kept value it does not know is none. */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const parsed = sessionNotice.safeParse(storage.get(NOTICE_KEY))

  return parsed.success ? parsed.data : undefined
}

/** Takes the word away: the sign-in page said it. */
export function forgetNotice(storage: KeyValueStorage): void {
  storage.remove(NOTICE_KEY)
}

/**
 * A flow dropped the word unsaid (an account signed in on this browser): it goes, and so does a
 * word raised before this that a session writes later (`saveNotice`), the mark moving on.
 */
export function dropNotice(storage: KeyValueStorage): void {
  const count = Number.parseInt(noticeMark(storage), 10)

  storage.remove(NOTICE_KEY)
  storage.set(DROPPED_KEY, String(Number.isSafeInteger(count) ? count + 1 : 1))
}
