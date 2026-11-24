import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'
import { device_sessionIdFactory, identityIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import { deviceHeaders } from './__fixtures__/auth-instance'
import { ADMISSION_HEADER, sessionHooks } from './session-hooks'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function directory(): Promise<LocalDb> {
  const local = (await openTestDb({ namespace: NAMESPACE, database: DIRECTORY }))._unsafeUnwrap()

  closers.push(() => local.close())

  return local
}

/** A session as Better Auth hands it to the hook before its row is written. */
function sessionRow() {
  const now = new Date()

  return {
    id: device_sessionIdFactory.create(),
    userId: identityIdFactory.create(),
    token: 'raw-token',
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(now.getTime() + 60_000),
  }
}

/** The headers of a request from the laptop, with the gateway's ask to wait when `asked`. */
function headersOf(asked: boolean): Headers {
  const headers = deviceHeaders('laptop')

  if (asked) {
    headers.set(ADMISSION_HEADER, 'pending')
  }

  return headers
}

/** Whether the row Better Auth writes for a request to `path` waits for its admission. */
async function writtenPending(path: string, asked: boolean): Promise<unknown> {
  const hooks = sessionHooks(manualClock(), await directory())
  const { data } = await hooks.create.before(sessionRow(), { path, headers: headersOf(asked) })

  return data.pending
}

/** Better Auth's paths of the steps that sign a device in once a second factor or a passkey passed. */
const VERIFY_PATHS = [
  '/two-factor/verify-totp',
  '/two-factor/verify-backup-code',
  '/passkey/verify-authentication',
] as const

describe('sessionHooks, the admission a new session waits for', () => {
  it.each(VERIFY_PATHS)(
    "writes the session of %s waiting when the gateway's request asks, admitted otherwise",
    async (path) => {
      expect(await writtenPending(path, true)).toBe(true)
      expect(await writtenPending(path, false)).toBe(false)
    },
  )

  it("writes a verification's session waiting whatever its request names, and a sign-in's only when asked", async () => {
    expect(await writtenPending('/verify-email', true)).toBe(true)
    expect(await writtenPending('/verify-email', false)).toBe(true)
    expect(await writtenPending('/sign-in/email', true)).toBe(true)
    expect(await writtenPending('/sign-in/email', false)).toBe(false)
  })

  it('admits as it is written the session of any other path, whatever its request names', async () => {
    expect(await writtenPending('/sign-up/email', true)).toBe(false)
    expect(await writtenPending('/two-factor/enable', true)).toBe(false)
  })
})
