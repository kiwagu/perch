import { afterEach, describe, expect, it } from 'vitest'

import { type LocalDb, recordId } from '@workspace/data'
import { openTestDb, readSchema } from '@workspace/data/testing'

import { DIRECTORY, NAMESPACE } from '../config'

import membershipIds from './__fixtures__/membership-ids.surql'
import membershipSweep from './__fixtures__/membership-sweep.surql'
import membershipsById from './__fixtures__/memberships-by-id.surql'
import organisationMemberships from './__fixtures__/organisation-memberships.surql'
import membershipAdminsStatement from './surql/membership-admins.surql'
import membershipOfEmailStatement from './surql/membership-of-email.surql'
import tenantRemoveStatement from './surql/tenant-remove.surql'

let directory: LocalDb | undefined

afterEach(async () => {
  await directory?.close()
  directory = undefined
})

/** A directory holding acme, beta and gamma with their members. */
async function opened(): Promise<LocalDb> {
  const local = (
    await openTestDb({ namespace: NAMESPACE, database: DIRECTORY, schema: readSchema('directory') })
  )._unsafeUnwrap()

  await local.db.query(organisationMemberships)
  directory = local

  return local
}

/** The plan the database gives for `statement`, as text. */
async function planOf(
  local: LocalDb,
  statement: string,
  params: Record<string, unknown>,
): Promise<string> {
  const [plan] = await local.db.query<[string]>(`EXPLAIN ${statement}`, params)

  return plan
}

describe('the membership_tenant index', () => {
  it("reads an organisation's admins through the membership_tenant index", async () => {
    const local = await opened()
    // The statement counts the rows of an inner SELECT, whose plan the count hides.
    const inner = /\(\s*(SELECT[^)]*)\)/.exec(membershipAdminsStatement)?.[1]
    const plan = await planOf(local, inner ?? expect.unreachable('a SELECT inside the count'), {
      tenant: recordId('tenant', 'acme'),
    })

    expect(plan).toContain('IndexScan')
    expect(plan).toContain('index: membership_tenant')
  })

  it("reads an organisation's member by email through the membership_tenant index", async () => {
    const local = await opened()
    const plan = await planOf(local, membershipOfEmailStatement, {
      tenant: recordId('tenant', 'acme'),
      email: 'cat@example.test',
    })

    expect(plan).toContain('IndexScan')
    expect(plan).toContain('index: membership_tenant')
  })

  it("still answers the organisation's admins and its member's role through the index", async () => {
    const local = await opened()
    const acme = recordId('tenant', 'acme')
    const [admins] = await local.db.query<[number]>(membershipAdminsStatement, { tenant: acme })
    const [role] = await local.db.query<[string | undefined]>(membershipOfEmailStatement, {
      tenant: acme,
      email: 'cat@example.test',
    })
    const [absent] = await local.db.query<[string | undefined]>(membershipOfEmailStatement, {
      tenant: recordId('tenant', 'gamma'),
      email: 'ann@example.test',
    })

    expect(admins).toBe(2)
    expect(role).toBe('member')
    expect(absent).toBeUndefined()
  })

  it("deletes an organisation's memberships by tenant = and by tenant IN with the index in place", async () => {
    const local = await opened()
    const [acme, beta, gamma] = ['acme', 'beta', 'gamma'].map((key) => recordId('tenant', key))
    const [removed] = await local.db.query<[unknown[]]>(membershipIds, { tenants: [acme, beta] })
    const [kept] = await local.db.query<[unknown[]]>(membershipIds, { tenants: [gamma] })

    // The rows are counted before either delete: a count taken through the deleting statement
    // would pass whatever it deleted.
    expect(removed).toHaveLength(5)
    expect(kept).toHaveLength(1)

    // The whole removal of an organisation deletes by `tenant =`; the seed's sweep, by a list.
    await local.db.query(tenantRemoveStatement, { database: 't_acme', tenant: acme })
    await local.db.query(membershipSweep, { tenants: [beta] })

    const [left] = await local.db.query<[unknown[]]>(membershipsById, { ids: removed })
    const [rest] = await local.db.query<[unknown[]]>(membershipIds, { tenants: [acme, beta] })
    const [others] = await local.db.query<[unknown[]]>(membershipsById, { ids: kept })

    expect(left).toEqual([])
    expect(rest).toEqual([])
    expect(others).toHaveLength(1)
  })
})
