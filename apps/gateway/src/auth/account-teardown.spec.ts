import { afterEach, describe, expect, it } from 'vitest'

import type { LocalDb } from '@workspace/data'
import { interceptQueries } from '@workspace/data/testing'
import { type IdentityId, idSchemas, profileIdFactory, tenantIdFactory } from '@workspace/ids'
import { privateRegionId } from '@workspace/replica'
import { z } from '@workspace/zod'

import accountRowsStatement from './__fixtures__/account-rows.surql'
import {
  accountServicesOf,
  deviceHeaders,
  type OpenedAuth,
  openAuth,
  signUpOn,
} from './__fixtures__/auth-instance'
import identityDeleteRefuseStatement from './__fixtures__/identity-delete-refuse.surql'
import membershipRowStatement from './__fixtures__/membership-row.surql'
import profileRowStatement from './__fixtures__/profile-row.surql'
import regionRowsStatement from './__fixtures__/region-rows.surql'
import settingsLocaleStatement from './__fixtures__/settings-locale.surql'
import { AccountTeardown } from './account-teardown'

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  await Promise.all(closers.splice(0).map((close) => close()))
})

const ANN = 'ann@example.test'
const BOB = 'bob@example.test'

/** The rows of an account `furnish` gave everything, table by table. */
const FURNISHED = {
  identity: 1,
  account: 1,
  device_session: 2,
  verification: 3,
  profile: 1,
  settings: 1,
  membership: 0,
  replica_head: 1,
  replica_snapshot: 1,
  replica_update: 2,
  replica_projected: 1,
  replica_peer: 1,
}

/** No row left in any table. */
const NONE_LEFT = Object.fromEntries(Object.keys(FURNISHED).map((table) => [table, 0]))

const accountRows = z.record(z.string(), z.array(z.unknown()))

async function harness() {
  const opened = await openAuth()

  closers.push(opened.close)

  return { ...opened, teardown: new AccountTeardown(opened.local) }
}

/**
 * Signs `email` up under the account's own name `Account name`, and gives it every row an account
 * keeps in the directory: two device sessions, a pending change of its email, a pending deletion,
 * a reset link, a profile under another name, settings in Spanish, and the server's copy of its
 * private region.
 */
async function furnish(opened: OpenedAuth, email: string): Promise<IdentityId> {
  const { auth, local, outbox } = opened
  const { emailChanges, accountDeletions, passwords } = accountServicesOf(opened)
  const { user } = await signUpOn(auth, email, deviceHeaders('laptop'), { name: 'Account name' })
  const identity = idSchemas.identity.schema.parse(user.id)

  await auth.api.signInEmail({
    body: { email, password: 'Pass-word-1' },
    headers: deviceHeaders('phone'),
  })
  ;(await emailChanges.ask(identity, email, `new.${email}`))._unsafeUnwrap()
  ;(await accountDeletions.ask(identity))._unsafeUnwrap()

  const mails = outbox.to(email).length

  expect((await passwords.requestReset(email))._unsafeUnwrap()).toBe('asked')
  await outbox.next(email, mails)
  await local.db.query(profileRowStatement, {
    id: profileIdFactory.create(),
    identity,
    name: 'Profile name',
    email,
  })
  await local.db.query(settingsLocaleStatement, { identity, locale: 'es' })
  await local.db.query(regionRowsStatement, { identity, region: privateRegionId(identity) })

  return identity
}

/** The record ids of `identity`'s rows in the directory, table by table, as text. */
async function rowsOf(local: LocalDb, identity: IdentityId): Promise<Record<string, string[]>> {
  const [rows] = await local.db.query<[unknown]>(accountRowsStatement, {
    identity,
    region: privateRegionId(identity),
  })

  return Object.fromEntries(
    Object.entries(accountRows.parse(rows)).map(([table, ids]) => [
      table,
      ids.map((id) => String(id)).sort(),
    ]),
  )
}

/** How many rows each table holds of `rows`. */
function counts(rows: Record<string, readonly string[]>): Record<string, number> {
  return Object.fromEntries(Object.entries(rows).map(([table, ids]) => [table, ids.length]))
}

describe('AccountTeardown', () => {
  it('removes every row of the account in the directory, and none of another account', async () => {
    const opened = await harness()
    const { local, teardown } = opened
    const ann = await furnish(opened, ANN)
    const bob = await furnish(opened, BOB)
    const bobs = await rowsOf(local, bob)

    expect(counts(await rowsOf(local, ann))).toEqual(FURNISHED)
    expect(counts(bobs)).toEqual(FURNISHED)

    expect((await teardown.remove(ann)).isOk()).toBe(true)

    expect(counts(await rowsOf(local, ann))).toEqual(NONE_LEFT)
    expect(await rowsOf(local, bob)).toEqual(bobs)
  })

  it('removes an account that is gone already as a success, changing nothing', async () => {
    const opened = await harness()
    const { local, teardown } = opened
    const ann = await furnish(opened, ANN)
    const bob = await furnish(opened, BOB)
    const bobs = await rowsOf(local, bob)

    expect((await teardown.remove(ann)).isOk()).toBe(true)
    expect((await teardown.remove(ann)).isOk()).toBe(true)

    expect(counts(await rowsOf(local, ann))).toEqual(NONE_LEFT)
    expect(await rowsOf(local, bob)).toEqual(bobs)
  })

  it('refuses an account that still belongs to an organisation, removing nothing', async () => {
    const opened = await harness()
    const { local, teardown } = opened
    const ann = await furnish(opened, ANN)

    await local.db.query(membershipRowStatement, {
      identity: ann,
      tenant: tenantIdFactory.create(),
    })

    expect((await teardown.remove(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(counts(await rowsOf(local, ann))).toEqual({ ...FURNISHED, membership: 1 })
  })

  it('removes all of the rows or none: a refused deletion of the identity, the last, keeps them all', async () => {
    const opened = await harness()
    const { local, teardown } = opened
    const ann = await furnish(opened, ANN)

    await local.db.query(identityDeleteRefuseStatement)

    expect((await teardown.remove(ann))._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(counts(await rowsOf(local, ann))).toEqual(FURNISHED)
  })

  it("answers the account's email, its own name and the language its settings name", async () => {
    const opened = await harness()
    const ann = await furnish(opened, ANN)

    expect((await opened.teardown.addressee(ann))._unsafeUnwrap()).toEqual({
      email: ANN,
      name: 'Account name',
      locale: 'es',
    })
  })

  it('answers the language the account signed up in until it has settings', async () => {
    const { auth, teardown } = await harness()
    const { user } = await signUpOn(auth, ANN, deviceHeaders('laptop'), {
      name: 'Ann',
      locale: 'es',
    })

    expect(
      (await teardown.addressee(idSchemas.identity.schema.parse(user.id)))._unsafeUnwrap(),
    ).toEqual({ email: ANN, name: 'Ann', locale: 'es' })
  })

  it('fails for an account that is gone, or whose settings could not be read', async () => {
    const opened = await harness()
    const { local, teardown } = opened
    const ann = await furnish(opened, ANN)
    const settingsDown = interceptQueries(local, (text) => {
      if (text.includes('FROM ONLY settings')) {
        throw new Error('the directory is down')
      }
    })

    expect((await new AccountTeardown(settingsDown).addressee(ann))._unsafeUnwrapErr().code).toBe(
      'data:QUERY_FAILED',
    )

    expect((await teardown.remove(ann)).isOk()).toBe(true)
    expect((await teardown.addressee(ann))._unsafeUnwrapErr().code).toBe('data:QUERY_FAILED')
  })
})
