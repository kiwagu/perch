import { z } from '@workspace/zod'

import { SESSION_NOTICES, type SessionNotice } from '../../platform/session.port'

import type { KeyValueStorage } from './key-value'

const NOTICE_KEY = 'perch.session.notice'

const sessionNotice = z.enum(SESSION_NOTICES)

/**
 * The words on what became of the device's data as its session ended, which say more than a
 * word on why it ended.
 */
const ABOUT_THE_DATA: ReadonlySet<SessionNotice> = new Set([
  'resend-after-sign-in',
  'delete-pending',
])

/** Leaves the sign-in page a word about how the last session ended. */
export function saveNotice(storage: KeyValueStorage, notice: SessionNotice): void {
  storage.set(NOTICE_KEY, notice)
}

/**
 * Leaves the sign-in page the word a screen's flow shows there, in place of a word on why a
 * session ended; a word on what became of the device's data stays.
 */
export function leaveNotice(storage: KeyValueStorage, notice: SessionNotice): void {
  const waiting = savedNotice(storage)

  if (waiting === undefined || !ABOUT_THE_DATA.has(waiting)) {
    saveNotice(storage, notice)
  }
}

/** The word the last session left for the sign-in page; a kept value it does not know is none. */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const parsed = sessionNotice.safeParse(storage.get(NOTICE_KEY))

  return parsed.success ? parsed.data : undefined
}

export function forgetNotice(storage: KeyValueStorage): void {
  storage.remove(NOTICE_KEY)
}
