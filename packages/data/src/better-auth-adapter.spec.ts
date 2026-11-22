import { isRetryableConflict, RecordId } from 'surrealdb'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import createTwoFactorWithoutCounter from './__fixtures__/create-two-factor-without-counter.surql'
import twoFactorTable from './__fixtures__/two-factor-table.surql'
import { surrealAuthAdapter } from './better-auth-adapter'
import { openTestDb, readSchema } from './testing'
import type { LocalDb } from './types'

type AuthOptions = Parameters<ReturnType<typeof surrealAuthAdapter>>[0]
type Adapter = ReturnType<ReturnType<typeof surrealAuthAdapter>>

/** What a transaction hands its callback: the adapter's operations, bound to that transaction. */
type Operations = Omit<Adapter, 'transaction'>

interface VerificationRow {
  readonly id: string
  readonly identifier: string
  readonly value: string
  readonly expiresAt: Date
}

interface TwoFactorRow {
  readonly id: string
  readonly secret: string
  readonly backupCodes: string
  readonly userId: string
  readonly failedVerificationCount?: number | null
  readonly lockedUntil?: Date | null
}

/**
 * Better Auth's options for the two models the specs use: the verification model as the directory
 * maps it, and the two-factor plugin's model with the fields Better Auth's own plugin declares.
 */
const OPTIONS: AuthOptions = {
  verification: {
    modelName: 'verification',
    fields: { expiresAt: 'expires_at', createdAt: 'created_at', updatedAt: 'updated_at' },
  },
  plugins: [
    {
      id: 'two-factor',
      schema: {
        twoFactor: {
          modelName: 'two_factor',
          fields: {
            secret: { type: 'string', required: true, fieldName: 'secret' },
            backupCodes: { type: 'string', required: true, fieldName: 'backup_codes' },
            userId: { type: 'string', required: true, fieldName: 'identity' },
            verified: { type: 'boolean', required: false, defaultValue: true },
            failedVerificationCount: {
              type: 'number',
              required: false,
              defaultValue: 0,
              fieldName: 'failed_verification_count',
            },
            lockedUntil: { type: 'date', required: false, fieldName: 'locked_until' },
          },
        },
      },
    },
  ],
}

/** How many times a race is run: the database's conflict is timing-dependent, not certain. */
const ROUNDS = 3

let local: LocalDb
let adapter: Adapter

beforeAll(async () => {
  const opened = await openTestDb({ schema: `${readSchema('directory')}\n${twoFactorTable}` })

  if (opened.isErr()) {
    throw new Error(opened.error.message)
  }

  local = opened.value
  adapter = surrealAuthAdapter(local)(OPTIONS)
})

afterAll(async () => {
  await local.close()
})

function verification(identifier: string): Promise<VerificationRow> {
  return adapter.create<VerificationRow>({
    model: 'verification',
    data: { identifier, value: 'token', expiresAt: new Date(Date.now() + 60_000) },
  })
}

function twoFactor(
  extra: Partial<Pick<TwoFactorRow, 'userId' | 'failedVerificationCount' | 'lockedUntil'>> = {},
): Promise<TwoFactorRow> {
  return adapter.create<TwoFactorRow>({
    model: 'twoFactor',
    data: { secret: 'secret', backupCodes: 'codes-0', userId: 'owner', ...extra },
  })
}

const byId = (id: string) => [{ field: 'id', value: id }]

async function verificationsOf(identifier: string): Promise<number> {
  return adapter.count({
    model: 'verification',
    where: [{ field: 'identifier', value: identifier }],
  })
}

async function twoFactorOf(id: string): Promise<TwoFactorRow | null> {
  return adapter.findOne<TwoFactorRow>({ model: 'twoFactor', where: byId(id) })
}

/** What calls that overlapped came to: the answers of those that finished, and the refusals. */
interface Raced<T> {
  readonly answers: T[]
  readonly refused: number
}

/**
 * Runs `count` copies of a call at once, so they overlap on the database. A call the database
 * refused for a conflict is counted, when the path may be refused (a transaction); any other
 * failure is thrown.
 */
async function together<T>(
  count: number,
  mayRefuse: boolean,
  call: (index: number) => Promise<T>,
): Promise<Raced<T>> {
  const settled = await Promise.allSettled(Array.from({ length: count }, (_, index) => call(index)))
  const answers: T[] = []
  let refused = 0

  for (const one of settled) {
    if (one.status === 'fulfilled') {
      answers.push(one.value)
    } else if (mayRefuse && isRetryableConflict(one.reason)) {
      refused += 1
    } else {
      throw one.reason
    }
  }

  return { answers, refused }
}

/**
 * The adapter's operations as Better Auth reaches them, directly and inside a transaction. A call
 * on the adapter that loses a race is sent again by the driver, at most five more times with a
 * growing pause, until a try finds the row as the winner left it; the races here settle within
 * that bound, so every call answers, though a conflict on the last try would reject the call with
 * it. A transaction is not run again, for what its callback did cannot be taken back: the later of
 * two overlapping transactions is refused with the database's conflict.
 */
const PATHS = [
  {
    name: 'the adapter',
    mayRefuse: false,
    run: <T>(work: (operations: Operations) => Promise<T>): Promise<T> => work(adapter),
  },
  {
    name: 'a transaction of the adapter',
    mayRefuse: true,
    run: <T>(work: (operations: Operations) => Promise<T>): Promise<T> => adapter.transaction(work),
  },
] as const

describe.each(PATHS)('consuming a row through $name', ({ name, mayRefuse, run }) => {
  it('returns the row under its names and deletes it', async () => {
    const row = await verification(`${name}-consume-returns`)

    const consumed = await run((operations) =>
      operations.consumeOne<VerificationRow>({ model: 'verification', where: byId(row.id) }),
    )

    expect(consumed?.id).toBe(row.id)
    expect(consumed?.identifier).toBe(`${name}-consume-returns`)
    expect(consumed?.value).toBe('token')
    expect(consumed?.expiresAt).toBeInstanceOf(Date)
    expect(await verificationsOf(`${name}-consume-returns`)).toBe(0)
  })

  it('answers null when no row matches, and deletes nothing', async () => {
    await verification(`${name}-consume-none-kept`)

    const consumed = await run((operations) =>
      operations.consumeOne<VerificationRow>({
        model: 'verification',
        where: [{ field: 'identifier', value: `${name}-consume-none-other` }],
      }),
    )

    expect(consumed).toBeNull()
    expect(await verificationsOf(`${name}-consume-none-kept`)).toBe(1)
  })

  it('consumes exactly one of the rows a predicate matches', async () => {
    await verification(`${name}-consume-several`)
    await verification(`${name}-consume-several`)
    await verification(`${name}-consume-several`)

    const consumed = await run((operations) =>
      operations.consumeOne<VerificationRow>({
        model: 'verification',
        where: [{ field: 'identifier', value: `${name}-consume-several` }],
      }),
    )

    expect(consumed?.identifier).toBe(`${name}-consume-several`)
    expect(await verificationsOf(`${name}-consume-several`)).toBe(2)
  })

  it('gives a row that two callers consume at once to exactly one of them', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const row = await verification(`${name}-consume-race-${round}`)

      const { answers } = await together(2, mayRefuse, () =>
        run((operations) =>
          operations.consumeOne<VerificationRow>({ model: 'verification', where: byId(row.id) }),
        ),
      )

      expect(answers.filter((one) => one !== null).map((one) => one?.id)).toEqual([row.id])
      expect(await verificationsOf(`${name}-consume-race-${round}`)).toBe(0)
    }
  })

  it('never gives one row to two of several callers that consume one predicate at once', async () => {
    const identifier = `${name}-consume-race-several`

    await verification(identifier)
    await verification(identifier)

    const { answers } = await together(3, mayRefuse, () =>
      run((operations) =>
        operations.consumeOne<VerificationRow>({
          model: 'verification',
          where: [{ field: 'identifier', value: identifier }],
        }),
      ),
    )

    const rows = answers.filter((one) => one !== null)

    expect(rows.length).toBeGreaterThanOrEqual(mayRefuse ? 1 : 2)
    expect(new Set(rows.map((one) => one?.id)).size).toBe(rows.length)
    expect(await verificationsOf(identifier)).toBe(2 - rows.length)
  })
})

describe.each(PATHS)('incrementing a row through $name', ({ name, mayRefuse, run }) => {
  it('adds to a counter and answers the row after the change', async () => {
    const row = await twoFactor({ failedVerificationCount: 2 })

    const after = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: byId(row.id),
        increment: { failedVerificationCount: 1 },
      }),
    )

    expect(after?.id).toBe(row.id)
    expect(after?.failedVerificationCount).toBe(3)
    expect((await twoFactorOf(row.id))?.failedVerificationCount).toBe(3)
  })

  it('counts from zero a counter no one has written', async () => {
    const id = `${name}-increment-unwritten`

    await local.db.query(createTwoFactorWithoutCounter, {
      id: new RecordId('two_factor', id),
      secret: 'secret',
      codes: 'codes-0',
      owner: 'owner',
    })

    const after = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: byId(id),
        increment: { failedVerificationCount: 1 },
      }),
    )

    expect(after?.failedVerificationCount).toBe(1)
  })

  it('counts from zero a counter that is null', async () => {
    const row = await twoFactor({ failedVerificationCount: null })

    const after = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: byId(row.id),
        increment: { failedVerificationCount: 1 },
      }),
    )

    expect(after?.failedVerificationCount).toBe(1)
  })

  it('answers null when no row matches', async () => {
    const after = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: byId(`${name}-increment-missing`),
        increment: { failedVerificationCount: 1 },
      }),
    )

    expect(after).toBeNull()
  })

  it('increments exactly one of the rows a predicate matches', async () => {
    const first = await twoFactor({ userId: `${name}-owner-of-several` })
    const second = await twoFactor({ userId: `${name}-owner-of-several` })

    const after = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: [{ field: 'userId', value: `${name}-owner-of-several` }],
        increment: { failedVerificationCount: 1 },
      }),
    )

    const counts = [
      (await twoFactorOf(first.id))?.failedVerificationCount,
      (await twoFactorOf(second.id))?.failedVerificationCount,
    ]

    expect(after?.failedVerificationCount).toBe(1)
    expect(counts.sort()).toEqual([0, 1])
  })

  it('loses no increment of two that run at once', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const row = await twoFactor()

      const { answers } = await together(2, mayRefuse, () =>
        run((operations) =>
          operations.incrementOne<TwoFactorRow>({
            model: 'twoFactor',
            where: byId(row.id),
            increment: { failedVerificationCount: 1 },
          }),
        ),
      )

      expect(answers.length).toBeGreaterThanOrEqual(mayRefuse ? 1 : 2)
      expect(answers.map((after) => after?.failedVerificationCount).sort()).toEqual(
        answers.map((_, index) => index + 1),
      )
      expect((await twoFactorOf(row.id))?.failedVerificationCount).toBe(answers.length)
    }
  })

  it('loses no increment of four that run at once', async () => {
    const row = await twoFactor()

    const { answers } = await together(4, mayRefuse, () =>
      run((operations) =>
        operations.incrementOne<TwoFactorRow>({
          model: 'twoFactor',
          where: byId(row.id),
          increment: { failedVerificationCount: 1 },
        }),
      ),
    )

    expect(answers.length).toBeGreaterThanOrEqual(mayRefuse ? 1 : 4)
    expect((await twoFactorOf(row.id))?.failedVerificationCount).toBe(answers.length)
  })

  it('lets the predicate guard the change: one decrement of the last unit wins', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const row = await twoFactor({ failedVerificationCount: 1 })

      const { answers } = await together(2, mayRefuse, () =>
        run((operations) =>
          operations.incrementOne<TwoFactorRow>({
            model: 'twoFactor',
            where: [
              { field: 'id', value: row.id },
              { field: 'failedVerificationCount', operator: 'gt', value: 0 },
            ],
            increment: { failedVerificationCount: -1 },
          }),
        ),
      )

      expect(answers.filter((after) => after !== null)).toHaveLength(1)
      expect((await twoFactorOf(row.id))?.failedVerificationCount).toBe(0)
    }
  })

  it('replaces a value only while it is the one the caller read, and answers the row', async () => {
    const row = await twoFactor()

    const stale = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: [
          { field: 'id', value: row.id },
          { field: 'backupCodes', value: 'codes-stale' },
        ],
        increment: {},
        set: { backupCodes: 'codes-1' },
      }),
    )
    const current = await run((operations) =>
      operations.incrementOne<TwoFactorRow>({
        model: 'twoFactor',
        where: [
          { field: 'id', value: row.id },
          { field: 'backupCodes', value: 'codes-0' },
        ],
        increment: {},
        set: { backupCodes: 'codes-1' },
      }),
    )

    expect(stale).toBeNull()
    expect(current?.backupCodes).toBe('codes-1')
    expect((await twoFactorOf(row.id))?.backupCodes).toBe('codes-1')
  })

  it('lets only one of two callers that replace the same value change the row', async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const row = await twoFactor()

      const { answers } = await together(2, mayRefuse, (caller) =>
        run((operations) =>
          operations.incrementOne<TwoFactorRow>({
            model: 'twoFactor',
            where: [
              { field: 'id', value: row.id },
              { field: 'backupCodes', value: 'codes-0' },
            ],
            increment: {},
            set: { backupCodes: `codes-won-by-${caller}` },
          }),
        ),
      )

      const winners = answers.filter((after) => after !== null)

      expect(winners).toHaveLength(1)
      expect((await twoFactorOf(row.id))?.backupCodes).toBe(winners[0]?.backupCodes)
    }
  })

  it('clears a lock that has ended, and leaves one that has not', async () => {
    const ended = await twoFactor({
      failedVerificationCount: 3,
      lockedUntil: new Date(Date.now() - 1_000),
    })
    const running = await twoFactor({
      failedVerificationCount: 3,
      lockedUntil: new Date(Date.now() + 60_000),
    })

    const clear = (id: string) =>
      run((operations) =>
        operations.incrementOne<TwoFactorRow>({
          model: 'twoFactor',
          where: [
            { field: 'id', value: id },
            { field: 'lockedUntil', operator: 'lte', value: new Date() },
          ],
          increment: {},
          set: { failedVerificationCount: 0, lockedUntil: null },
        }),
      )

    const cleared = await clear(ended.id)
    const refused = await clear(running.id)

    expect(cleared?.failedVerificationCount).toBe(0)
    expect(cleared?.lockedUntil).toBeNull()
    expect(refused).toBeNull()
    expect((await twoFactorOf(running.id))?.failedVerificationCount).toBe(3)
  })

  it('refuses a change that names neither an increment nor a value', async () => {
    const row = await twoFactor()

    await expect(
      run((operations) =>
        operations.incrementOne<TwoFactorRow>({
          model: 'twoFactor',
          where: byId(row.id),
          increment: {},
        }),
      ),
    ).rejects.toThrow('incrementOne requires a non-empty `increment` or `set`')
  })
})

describe('a transaction that consumes or increments a row', () => {
  it('leaves the row as it was when the transaction fails', async () => {
    const token = await verification('transaction-fails')
    const counted = await twoFactor()

    await expect(
      adapter.transaction(async (operations) => {
        await operations.consumeOne({ model: 'verification', where: byId(token.id) })
        await operations.incrementOne({
          model: 'twoFactor',
          where: byId(counted.id),
          increment: { failedVerificationCount: 1 },
        })

        throw new Error('the transaction fails')
      }),
    ).rejects.toThrow('the transaction fails')

    expect(await verificationsOf('transaction-fails')).toBe(1)
    expect((await twoFactorOf(counted.id))?.failedVerificationCount).toBe(0)
  })

  it('keeps a consume made after a read of the same row, as a sign-in does', async () => {
    const row = await verification('transaction-reads-first')

    const consumed = await adapter.transaction(async (operations) => {
      const latest = await operations.findMany<VerificationRow>({
        model: 'verification',
        where: [{ field: 'identifier', value: 'transaction-reads-first' }],
        limit: 1,
      })

      return operations.consumeOne<VerificationRow>({
        model: 'verification',
        where: byId(latest[0]?.id ?? ''),
      })
    })

    expect(consumed?.id).toBe(row.id)
    expect(await verificationsOf('transaction-reads-first')).toBe(0)
  })
})

describe('a transaction the database refuses for a conflict', () => {
  it('runs its callback once and fails, leaving nothing it did', async () => {
    const counted = await twoFactor()
    const delivered: string[] = []
    let runs = 0

    const outcome = adapter.transaction(async (operations) => {
      runs += 1

      const created = await operations.create<VerificationRow>({
        model: 'verification',
        data: {
          identifier: 'transaction-conflicts',
          value: 'token',
          expiresAt: new Date(Date.now() + 60_000),
        },
      })

      await operations.incrementOne({
        model: 'twoFactor',
        where: byId(counted.id),
        increment: { failedVerificationCount: 1 },
      })

      // What a callback starts and cannot take back, as a mail sent about the row it created.
      delivered.push(created.id)

      if (runs === 1) {
        // Another writer commits the same counter before this transaction does.
        await adapter.incrementOne({
          model: 'twoFactor',
          where: byId(counted.id),
          increment: { failedVerificationCount: 1 },
        })
      }
    })

    await expect(outcome).rejects.toSatisfy(isRetryableConflict)
    expect(runs).toBe(1)
    expect(delivered).toHaveLength(1)
    expect(await verificationsOf('transaction-conflicts')).toBe(0)
    expect((await twoFactorOf(counted.id))?.failedVerificationCount).toBe(1)
  })

  it('is refused the row another consumer committed first, which that consumer keeps', async () => {
    const row = await verification('transaction-loses-consume')
    let seen: VerificationRow | null = null
    let taken: VerificationRow | null = null

    const outcome = adapter.transaction(async (operations) => {
      seen = await operations.consumeOne<VerificationRow>({
        model: 'verification',
        where: byId(row.id),
      })
      taken = await adapter.consumeOne<VerificationRow>({
        model: 'verification',
        where: byId(row.id),
      })
    })

    await expect(outcome).rejects.toSatisfy(isRetryableConflict)
    expect(taken).toMatchObject({ id: row.id })
    expect(seen).toMatchObject({ id: row.id })
    expect(await verificationsOf('transaction-loses-consume')).toBe(0)
  })
})
