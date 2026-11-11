import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries, openTestDb } from '@workspace/data/testing'
import { type IdentityId, identityIdFactory } from '@workspace/ids'

import {
  MADE_AT,
  writeAccount,
  writeOrganisation,
  writeProfile,
  writeSession,
} from './__fixtures__/accounts'
import { AccountDirectory } from './account-directory'

const DAY_MS = 24 * 60 * 60 * 1000

/** The instant `days` days after the first account was made. */
const day = (days: number): Date => new Date(MADE_AT.getTime() + days * DAY_MS)

/** Closes what a test opened. */
const opened: LocalDb[] = []

afterEach(async () => {
  for (const local of opened.splice(0)) {
    await local.close()
  }
})

async function directoryDb(): Promise<LocalDb> {
  const local = (await openTestDb())._unsafeUnwrap()

  opened.push(local)

  return local
}

/** Identities from the greatest to the least, the order two accounts made at once are listed in. */
const byIdDescending = (ids: readonly IdentityId[]): IdentityId[] =>
  [...ids].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0))

describe('AccountDirectory.list', () => {
  it('lists every account, the newest first, with exactly what the list shows of each', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test', name: 'Ann' })
    const bob = await writeAccount(local, {
      email: 'bob@example.test',
      name: 'Bob',
      createdAt: day(1),
      emailVerified: true,
      banned: true,
      banReason: 'spam',
      role: 'operator',
    })
    const page = (
      await new AccountDirectory(local).list({ q: '', page: 1, size: 25 })
    )._unsafeUnwrap()

    expect(page).toEqual({
      accounts: [
        {
          id: bob,
          name: 'Bob',
          email: 'bob@example.test',
          emailVerified: true,
          banned: true,
          operator: true,
          createdAt: day(1),
        },
        {
          id: ann,
          name: 'Ann',
          email: 'ann@example.test',
          emailVerified: false,
          banned: false,
          operator: false,
          createdAt: MADE_AT,
        },
      ],
      total: 2,
    })
  })

  it("names an account by its profile's name, and by the name it signed up with while it has no profile", async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test', name: 'Ann Signup' })
    const bob = await writeAccount(local, {
      email: 'bob@example.test',
      name: 'Bob Signup',
      createdAt: day(1),
    })

    await writeProfile(local, ann, 'Annie Hall')

    const { accounts } = (
      await new AccountDirectory(local).list({ q: '', page: 1, size: 25 })
    )._unsafeUnwrap()

    expect(accounts.map(({ id, name }) => ({ id, name }))).toEqual([
      { id: bob, name: 'Bob Signup' },
      { id: ann, name: 'Annie Hall' },
    ])
  })

  it("marks an operator by its role alone: the plugin's user and no role are none", async () => {
    const local = await directoryDb()

    await writeAccount(local, { email: 'ann@example.test', role: 'operator' })
    await writeAccount(local, { email: 'bob@example.test', role: 'user', createdAt: day(1) })
    await writeAccount(local, { email: 'cat@example.test', createdAt: day(2) })

    const { accounts } = (
      await new AccountDirectory(local).list({ q: '', page: 1, size: 25 })
    )._unsafeUnwrap()

    expect(accounts.map(({ email, operator }) => ({ email, operator }))).toEqual([
      { email: 'cat@example.test', operator: false },
      { email: 'bob@example.test', operator: false },
      { email: 'ann@example.test', operator: true },
    ])
  })

  it('finds accounts by a part of the email or of the shown name, whatever its case', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test', name: 'Ann' })
    const bob = await writeAccount(local, {
      email: 'bob@other.test',
      name: 'Daniel Quill',
      createdAt: day(1),
    })
    const cat = await writeAccount(local, {
      email: 'cat@example.test',
      name: 'Zed Signup',
      createdAt: day(2),
    })

    await writeProfile(local, ann, 'Annie Hall')
    await writeProfile(local, cat, 'Cat Stevens')

    const directory = new AccountDirectory(local)
    const found = async (q: string) => {
      const page = (await directory.list({ q, page: 1, size: 25 }))._unsafeUnwrap()

      return { ids: page.accounts.map(({ id }) => id), total: page.total }
    }

    expect(await found('EXAMPLE.test')).toEqual({ ids: [cat, ann], total: 2 })
    expect(await found('hALL')).toEqual({ ids: [ann], total: 1 })
    expect(await found('QUILL')).toEqual({ ids: [bob], total: 1 })
    // An account with a profile is not found by the name it signed up with: that name is not shown.
    expect(await found('zed')).toEqual({ ids: [], total: 0 })
    expect(await found('')).toEqual({ ids: [cat, bob, ann], total: 3 })
  })

  it('lists no account for a profile whose identity is gone', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test' })

    await writeProfile(local, identityIdFactory.create(), 'Nobody')

    expect(
      (await new AccountDirectory(local).list({ q: '', page: 1, size: 25 }))._unsafeUnwrap(),
    ).toMatchObject({ accounts: [{ id: ann }], total: 1 })
  })

  it('pages the accounts, a page past the last holding none with the number of them all', async () => {
    const local = await directoryDb()
    const made: IdentityId[] = []

    for (let index = 0; index < 5; index += 1) {
      made.push(
        await writeAccount(local, { email: `user${index}@example.test`, createdAt: day(index) }),
      )
    }

    const directory = new AccountDirectory(local)
    const page = async (number: number) =>
      (await directory.list({ q: '', page: number, size: 2 }))._unsafeUnwrap()
    const newest = [...made].reverse()

    expect(await page(1)).toMatchObject({ total: 5 })
    expect((await page(1)).accounts.map(({ id }) => id)).toEqual(newest.slice(0, 2))
    expect((await page(2)).accounts.map(({ id }) => id)).toEqual(newest.slice(2, 4))
    expect((await page(3)).accounts.map(({ id }) => id)).toEqual(newest.slice(4))
    expect(await page(4)).toEqual({ accounts: [], total: 5 })
  })

  it('orders accounts made at the same instant by their id, the same on every page', async () => {
    const local = await directoryDb()
    const older = await writeAccount(local, { email: 'old@example.test' })
    const tied = [
      await writeAccount(local, { email: 'ann@example.test', createdAt: day(1) }),
      await writeAccount(local, { email: 'bob@example.test', createdAt: day(1) }),
      await writeAccount(local, { email: 'cat@example.test', createdAt: day(1) }),
    ]
    const directory = new AccountDirectory(local)
    const listed: IdentityId[] = []

    for (const number of [1, 2]) {
      const { accounts } = (await directory.list({ q: '', page: number, size: 2 }))._unsafeUnwrap()

      listed.push(...accounts.map(({ id }) => id))
    }

    expect(listed).toEqual([...byIdDescending(tied), older])
  })

  it('reads the page and the count in one query: a sign-up committed before it is in both', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test' })
    const sent: string[] = []
    let release = () => {}
    const held = new Promise<void>((resolve) => {
      release = resolve
    })
    const directory = new AccountDirectory(
      interceptQueries(local, (text) => {
        sent.push(text)

        return held
      }),
    )
    const listing = directory.list({ q: '', page: 1, size: 25 })

    // The one query waits; a sign-up commits meanwhile; the page and the count both see it.
    expect(sent).toHaveLength(1)

    const bob = await writeAccount(local, { email: 'bob@example.test', createdAt: day(1) })

    release()

    const page = (await listing)._unsafeUnwrap()

    expect(sent).toHaveLength(1)
    expect({ ids: page.accounts.map(({ id }) => id), total: page.total }).toEqual({
      ids: [bob, ann],
      total: 2,
    })
  })

  it('answers a failure of the directory as one, with no account', async () => {
    const local = await directoryDb()
    const directory = new AccountDirectory(
      interceptQueries(local, () => {
        throw new Error('the directory is gone')
      }),
    )

    expect((await directory.list({ q: '', page: 1, size: 25 }))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )
  })
})

describe('AccountDirectory.read', () => {
  it('reads an account with its profile, its last seen device, its operator mark, its ban and its organisations', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, {
      email: 'ann@example.test',
      name: 'Ann Signup',
      emailVerified: true,
      banned: true,
      banReason: 'spam',
      role: 'operator',
    })

    await writeProfile(local, ann, 'Annie Hall')
    await writeOrganisation(local, ann, { key: 'beta', name: 'Beta', role: 'member' })
    await writeOrganisation(local, ann, { key: 'acme', name: 'Acme', role: 'admin' })
    await writeSession(local, ann, { lastSeenAt: day(3) })

    expect((await new AccountDirectory(local).read(ann))._unsafeUnwrap()).toEqual({
      id: ann,
      name: 'Annie Hall',
      email: 'ann@example.test',
      emailVerified: true,
      createdAt: MADE_AT,
      hasProfile: true,
      lastSeenAt: day(3),
      operator: true,
      banned: true,
      banReason: 'spam',
      organisations: [
        { key: 'acme', name: 'Acme', role: 'admin' },
        { key: 'beta', name: 'Beta', role: 'member' },
      ],
    })
  })

  it('reads an account that never signed in: its sign-up name, no profile, never seen, in no organisation', async () => {
    const local = await directoryDb()
    const bob = await writeAccount(local, { email: 'bob@example.test', name: 'Bob Signup' })

    expect((await new AccountDirectory(local).read(bob))._unsafeUnwrap()).toEqual({
      id: bob,
      name: 'Bob Signup',
      email: 'bob@example.test',
      emailVerified: false,
      createdAt: MADE_AT,
      hasProfile: false,
      operator: false,
      banned: false,
      organisations: [],
    })
  })

  it('sees an account last when one of its kept sessions was seen last, ended ones included and waiting ones not', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test' })

    await writeSession(local, ann, { lastSeenAt: day(2) })
    await writeSession(local, ann, { lastSeenAt: day(5), endedAt: day(5) })
    // A sign-in still waiting for its admission was never handed to its device.
    await writeSession(local, ann, { lastSeenAt: day(9), pending: true })

    expect((await new AccountDirectory(local).read(ann))._unsafeUnwrap()).toMatchObject({
      lastSeenAt: day(5),
    })
  })

  it("leaves out an organisation still provisioning, which is nobody's yet", async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test' })

    await writeOrganisation(local, ann, { key: 'acme', name: 'Acme', role: 'admin' })
    await writeOrganisation(local, ann, {
      key: 'beta',
      name: 'Beta',
      role: 'admin',
      status: 'provisioning',
    })

    expect((await new AccountDirectory(local).read(ann))._unsafeUnwrap()).toMatchObject({
      organisations: [{ key: 'acme', name: 'Acme', role: 'admin' }],
    })
  })

  it('reads no account for an id no account has', async () => {
    const local = await directoryDb()

    await writeAccount(local, { email: 'ann@example.test' })

    expect(
      (await new AccountDirectory(local).read(identityIdFactory.create()))._unsafeUnwrap(),
    ).toBeUndefined()
  })

  it('answers a failure of the directory as one, with no account', async () => {
    const local = await directoryDb()
    const ann = await writeAccount(local, { email: 'ann@example.test' })
    const directory = new AccountDirectory(
      interceptQueries(local, () => {
        throw new Error('the directory is gone')
      }),
    )

    expect((await directory.read(ann))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
  })
})
