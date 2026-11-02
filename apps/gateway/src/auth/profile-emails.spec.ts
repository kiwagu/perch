import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError } from '@workspace/data'
import { idSchemas } from '@workspace/ids'
import type { RecordWrite } from '@workspace/replica/server'

import { KeyedTurns } from '../keyed-turns'

import { accountServicesOf, deviceHeaders, openAuth, signUpOn } from './__fixtures__/auth-instance'
import profileRowStatement from './__fixtures__/profile-row.surql'
import { holdTurn } from './auth-handler/__fixtures__/mount'
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
  const turns = new KeyedTurns<string>()
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
    turns,
  })
  const { emailChanges } = accountServicesOf(opened)

  return { ...opened, identity, profile, profiles, writes, lines, turns, emailChanges }
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

  it('writes the email the account has when its turn comes, and before the work asked of the account after it', async () => {
    const { profiles, identity, writes, turns, emailChanges } = await harness([])
    // Work of the account holds its turn: the follow asked now waits behind it.
    const release = await holdTurn(turns, identity)

    profiles.queue(identity)
    // The email moves again before the follow runs.
    expect(
      (await emailChanges.move(identity, ANN, 'ann.second@example.test'))._unsafeUnwrap(),
    ).toBe(true)

    const order: string[] = []
    const later = turns.run(identity, async () => {
      order.push(`later work, ${writes.length} written before it`)
    })

    expect(writes).toEqual([])
    release()
    await later

    expect(writes.map(({ write }) => write.set['email'])).toEqual(['ann.second@example.test'])
    expect(order).toEqual(['later work, 1 written before it'])
  })

  it("queues a follow at a hello when the profile's email is not the account's, and nothing when it is", async () => {
    const { profiles, identity, writes, turns, emailChanges, lines } = await harness([])

    profiles.reconcile(identity)
    await turns.run(identity, async () => undefined)
    // The profile carries the account's email: nothing to write.
    expect(writes).toEqual([])

    expect(
      (await emailChanges.move(identity, ANN, 'ann.second@example.test'))._unsafeUnwrap(),
    ).toBe(true)
    profiles.reconcile(identity)

    await vi.waitFor(() =>
      expect(writes.map(({ write }) => write.set['email'])).toEqual(['ann.second@example.test']),
    )
    expect(lines).toEqual([])
  })

  it('queues nothing at a hello of an account with no profile yet, and logs nothing', async () => {
    const { profiles, identity, writes, turns, lines } = await harness([], false)

    profiles.reconcile(identity)
    await vi.waitFor(async () => {
      await turns.run(identity, async () => undefined)
      expect(writes).toEqual([])
    })

    expect(lines).toEqual([])
  })
})
