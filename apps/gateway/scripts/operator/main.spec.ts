import { errAsync, okAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { dataError, type LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import identityCreateStatement from './__fixtures__/identity-create.surql'
import identityReadStatement from './__fixtures__/identity-read.surql'
import identityRoleGivenStatement from './__fixtures__/identity-role-given.surql'
import { main } from './main'
import type { OperatorRequest } from './operator-options'

const DEV = { SURREAL_DEV_URL: 'http://127.0.0.1:8000' }

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(closers.splice(0).map((close) => close()))
})

/** What the command printed, by stream, and the directories it opened and closed. */
function run() {
  const out = vi.spyOn(console, 'log').mockImplementation(() => undefined)
  const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined)
  const opened: OperatorRequest[] = []
  const closed: OperatorRequest[] = []

  return {
    opened,
    closed,
    printed: () => [...out.mock.calls, ...errors.mock.calls].flat().join('\n'),
    printedErrors: () => errors.mock.calls.flat().join('\n'),
    /** Opens the in-memory directory, as the command opens a stand's, and closes it as it does. */
    over: (local: LocalDb) => (request: OperatorRequest) => {
      opened.push(request)

      return okAsync<LocalDb, never>({
        ...local,
        close: () => {
          closed.push(request)

          return Promise.resolve()
        },
      })
    },
  }
}

async function directory(role?: 'user' | 'operator'): Promise<LocalDb> {
  const local = (await openTestDb({ namespace: 'app', database: 'directory' }))._unsafeUnwrap()

  closers.push(local.close)
  await local.db.query(identityCreateStatement, { key: 'ann', email: 'ann@example.test' })

  if (role !== undefined) {
    await local.db.query(identityRoleGivenStatement, { key: 'ann', role })
  }

  return local
}

async function roleOf(local: LocalDb): Promise<unknown> {
  const [row] = await local.db.query<[Record<string, unknown>]>(identityReadStatement, {
    key: 'ann',
  })

  return row?.['role']
}

describe('main', () => {
  it('grants the role to the account of the email and exits 0, closing the directory', async () => {
    const local = await directory('user')
    const command = run()

    expect(await main(['grant', 'ann@example.test'], DEV, command.over(local))).toBe(0)
    expect(await roleOf(local)).toBe('operator')
    expect(command.closed).toHaveLength(1)
    expect(command.printed()).toContain('ann@example.test')
  })

  it('opens the stand its options name, at its WebSocket endpoint', async () => {
    const local = await directory()
    const command = run()

    await main(
      ['--url=http://127.0.0.1:9000', '--user=owner', '--pass=s3cret', 'grant', 'ann@example.test'],
      DEV,
      command.over(local),
    )

    expect(command.opened).toEqual([
      {
        action: 'grant',
        email: 'ann@example.test',
        url: 'ws://127.0.0.1:9000/rpc',
        namespace: 'app',
        database: 'directory',
        credentials: { username: 'owner', password: 's3cret' },
      },
    ])
  })

  it('revokes it, leaving the default role, and exits 0', async () => {
    const local = await directory('operator')
    const command = run()

    expect(await main(['revoke', 'ann@example.test'], DEV, command.over(local))).toBe(0)
    expect(await roleOf(local)).toBe('user')
  })

  it('exits 1 for an email no account has, saying so, and writes nothing', async () => {
    const local = await directory()
    const command = run()

    expect(await main(['grant', 'bob@example.test'], DEV, command.over(local))).toBe(1)
    expect(await roleOf(local)).toBeUndefined()
    expect(command.printedErrors()).toMatch(/no account/)
    expect(command.closed).toHaveLength(1)
  })

  it('exits 2 with the usage, before it opens anything, for arguments it refuses', async () => {
    const local = await directory()

    for (const argv of [[], ['grant'], ['grant', 'ann'], ['promote', 'ann@example.test']]) {
      const command = run()

      expect(await main(argv, DEV, command.over(local))).toBe(2)
      expect(command.opened).toEqual([])
      expect(command.printedErrors()).toMatch(/usage: operator /)
    }

    const command = run()

    expect(await main(['grant', 'ann@example.test'], {}, command.over(local))).toBe(2)
    expect(command.opened).toEqual([])
    expect(command.printedErrors()).toMatch(/SURREAL_DEV_URL/)
    expect(await roleOf(local)).toBeUndefined()
  })

  it('exits 1, saying what failed and never the password, when the stand cannot be opened', async () => {
    const command = run()
    const refused = () =>
      errAsync(
        dataError('data:OPEN_FAILED', 'could not open ws://127.0.0.1:9/rpc', new Error('s3cret')),
      )

    expect(await main(['--pass=s3cret', 'grant', 'ann@example.test'], DEV, refused)).toBe(1)
    expect(command.printedErrors()).toContain(
      'data:OPEN_FAILED could not open ws://127.0.0.1:9/rpc',
    )
    // The failure's cause carries the password here: nothing written names it.
    expect(command.printed()).not.toContain('s3cret')
  })

  it('never prints the password it was given', async () => {
    const local = await directory()
    const command = run()

    await main(['--pass=s3cret', 'grant', 'ann@example.test'], DEV, command.over(local))
    await main(['--pass=s3cret', 'grant', 'bob@example.test'], DEV, command.over(local))
    await main(['--pass=s3cret', '--password=s3cret', 'grant', 'ann@example.test'], DEV, () =>
      errAsync(dataError('data:OPEN_FAILED', 'could not open it', new Error('s3cret'))),
    )

    expect(command.printed()).not.toContain('s3cret')
  })
})
