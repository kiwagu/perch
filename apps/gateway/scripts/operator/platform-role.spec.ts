import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { openTestDb } from '@workspace/data/testing'

import identityCountStatement from './__fixtures__/identity-count.surql'
import identityCreateStatement from './__fixtures__/identity-create.surql'
import identityReadStatement from './__fixtures__/identity-read.surql'
import identityRoleGivenStatement from './__fixtures__/identity-role-given.surql'
import { setPlatformRole } from './platform-role'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

async function directory(): Promise<LocalDb> {
  const local = (await openTestDb({ namespace: 'app', database: 'directory' }))._unsafeUnwrap()

  closers.push(local.close)

  return local
}

async function identity(
  local: LocalDb,
  key: string,
  email: string,
  role?: 'user' | 'operator',
): Promise<void> {
  await local.db.query(identityCreateStatement, { key, email })

  if (role !== undefined) {
    await local.db.query(identityRoleGivenStatement, { key, role })
  }
}

async function row(local: LocalDb, key: string): Promise<Record<string, unknown>> {
  const [found] = await local.db.query<[Record<string, unknown>]>(identityReadStatement, { key })

  return found ?? {}
}

describe('setPlatformRole', () => {
  it('makes an account with no role an operator', async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test')

    expect((await setPlatformRole(local, 'ann@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'set',
    )
    expect((await row(local, 'ann'))['role']).toBe('operator')
  })

  it("makes an account with the plugin's default role an operator", async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test', 'user')

    expect((await setPlatformRole(local, 'ann@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'set',
    )
    expect((await row(local, 'ann'))['role']).toBe('operator')
  })

  it('takes the role of an operator back to the default one, and says set', async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test', 'operator')

    expect((await setPlatformRole(local, 'ann@example.test', 'user'))._unsafeUnwrap()).toBe('set')
    expect((await row(local, 'ann'))['role']).toBe('user')
  })

  it('says set again for an account that already holds the role', async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test', 'operator')

    expect((await setPlatformRole(local, 'ann@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'set',
    )
    expect((await row(local, 'ann'))['role']).toBe('operator')
  })

  it('finds the account of an email in any case', async () => {
    const local = await directory()

    await identity(local, 'ann', 'Ann@Example.TEST')

    expect((await setPlatformRole(local, 'ANN@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'set',
    )
    expect((await row(local, 'ann'))['role']).toBe('operator')
  })

  it('says no-account for an email no account has, and writes nothing', async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test')

    expect((await setPlatformRole(local, 'bob@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'no-account',
    )
    expect((await row(local, 'ann'))['role']).toBeUndefined()

    const [count] = await local.db.query<[number]>(identityCountStatement)

    expect(count).toBe(1)
  })

  it('changes the role of that account alone, and nothing else of it', async () => {
    const local = await directory()

    await identity(local, 'ann', 'ann@example.test', 'user')
    await identity(local, 'bob', 'bob@example.test', 'user')

    const { role: before, ...annBefore } = await row(local, 'ann')
    const bobBefore = await row(local, 'bob')

    expect((await setPlatformRole(local, 'ann@example.test', 'operator'))._unsafeUnwrap()).toBe(
      'set',
    )

    const { role: after, ...annAfter } = await row(local, 'ann')

    expect(before).toBe('user')
    expect(after).toBe('operator')
    expect(annAfter).toEqual(annBefore)
    expect(annAfter).toMatchObject({ banned: true, ban_reason: 'spam', email_verified: true })
    expect(await row(local, 'bob')).toEqual(bobBefore)
  })

  it('fails, naming nothing of the email, once the directory is closed', async () => {
    const local = await directory()

    await local.close()

    const error = (await setPlatformRole(local, 'ann@example.test', 'operator'))._unsafeUnwrapErr()

    expect(error.code).toBe('data:WRITE_FAILED')
    expect(error.message).not.toContain('ann@example.test')
  })
})
