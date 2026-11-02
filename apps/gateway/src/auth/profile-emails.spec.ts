import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it } from 'vitest'

import { dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { RecordWrite } from '@workspace/replica/server'

import { deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import profileRowStatement from './__fixtures__/profile-row.surql'
import { ProfileEmails } from './profile-emails'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'

/** What the hub stand-in answers each write, in turn; it keeps every write it is asked. */
type HubAnswer = 'written' | 'failed' | 'rejected'

/** Ann signed up, with a profile in the directory when `profiled`, and her profile's follower. */
async function harness(answers: readonly HubAnswer[], profiled = true) {
  const opened = await openAuth()

  closers.push(opened.close)

  const { user } = await signUpOn(opened.auth, ANN, deviceHeaders('laptop'))
  const identity = idSchemas.identity.schema.parse(user.id)
  const profile = `prf_${identity.slice(identity.indexOf('_') + 1)}`

  if (profiled) {
    await opened.local.db.query(profileRowStatement, {
      id: profile,
      identity,
      name: 'Ann',
      email: ANN,
    })
  }

  const writes: Array<{ readonly region: string; readonly write: RecordWrite }> = []
  const lines: Array<{ readonly level: string; readonly code: string; readonly message: string }> =
    []
  const profiles = new ProfileEmails({
    directory: opened.local,
    hub: {
      writeRecord: (region, write) => {
        const answer = answers[writes.length] ?? 'written'

        writes.push({ region: region.id, write })

        if (answer === 'written') {
          return okAsync(writes.length)
        }

        return errAsync(
          dataError(
            answer === 'rejected' ? 'data:WRITE_REJECTED' : 'data:WRITE_FAILED',
            `the write of ${ANN} failed`,
          ),
        )
      },
    },
    log: {
      error: ({ code }, message) => lines.push({ level: 'error', code, message }),
      warn: ({ code }, message) => lines.push({ level: 'warn', code, message }),
    },
  })

  return { ...opened, identity, profile, profiles, writes, lines }
}

describe('ProfileEmails', () => {
  it("writes the identity's email as it is into its profile, in its private region", async () => {
    const { profiles, identity, profile, writes, lines } = await harness([])

    await profiles.follow(identity)

    expect(writes).toEqual([
      {
        region: `identity:${identity}`,
        write: { table: 'profile', id: profile, set: { email: ANN } },
      },
    ])
    expect(lines).toEqual([])
  })

  it('tries a write that failed once more, and logs nothing when the second goes through', async () => {
    const { profiles, identity, writes, lines } = await harness(['failed', 'written'])

    await profiles.follow(identity)

    expect(writes).toHaveLength(2)
    expect(lines).toEqual([])
  })

  it('logs a write that failed twice by its code alone, and resolves', async () => {
    const { profiles, identity, writes, lines } = await harness(['failed', 'failed'])

    await profiles.follow(identity)

    expect(writes).toHaveLength(2)
    expect(lines).toEqual([
      {
        level: 'error',
        code: 'data:WRITE_FAILED',
        message: 'the new email of an account did not reach its profile',
      },
    ])
  })

  it('logs a write the hub refuses at once, without trying it again', async () => {
    const { profiles, identity, writes, lines } = await harness(['rejected'])

    await profiles.follow(identity)

    expect(writes).toHaveLength(1)
    expect(lines.map(({ code }) => code)).toEqual(['data:WRITE_REJECTED'])
  })

  it('writes nothing for an account with no profile yet, and logs that by its code', async () => {
    const { profiles, identity, writes, lines } = await harness([], false)

    await profiles.follow(identity)

    expect(writes).toEqual([])
    expect(lines).toEqual([
      {
        level: 'warn',
        code: 'auth:PROFILE_NOT_STARTED',
        message: 'the account has no profile to carry its new email yet',
      },
    ])
    expect(JSON.stringify(lines)).not.toContain(ANN)
  })
})
