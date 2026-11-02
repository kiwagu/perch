import { z } from '@workspace/zod'

import type { SessionNotice } from '../../platform/session.port'

import type { KeyValueStorage } from './key-value'

const NOTICE_KEY = 'perch.session.notice'

const sessionNotice = z.enum([
  'resend-after-sign-in',
  'signed-out-elsewhere',
  'password-changed-elsewhere',
  'delete-pending',
])

/** Leaves the sign-in page a word about how the last session ended. */
export function saveNotice(storage: KeyValueStorage, notice: SessionNotice): void {
  storage.set(NOTICE_KEY, notice)
}

/** The word the last session left for the sign-in page; a kept value it does not know is none. */
export function savedNotice(storage: KeyValueStorage): SessionNotice | undefined {
  const parsed = sessionNotice.safeParse(storage.get(NOTICE_KEY))

  return parsed.success ? parsed.data : undefined
}

export function forgetNotice(storage: KeyValueStorage): void {
  storage.remove(NOTICE_KEY)
}
