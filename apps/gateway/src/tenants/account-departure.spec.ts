import { errAsync, ok, okAsync, ResultAsync } from 'neverthrow'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { type DataError, dataError, recordId } from '@workspace/data'
import { membershipIdFactory, tenantIdFactory } from '@workspace/ids'

import identityByEmailStatement from '../auth/surql/identity-by-email.surql'

import { closeDepartures, departureHarness } from './__fixtures__/departures'
import identityForget from './__fixtures__/identity-forget.surql'
import membershipPromote from './__fixtures__/membership-promote.surql'
import tenantInterrupt from './__fixtures__/tenant-interrupt.surql'
import departingMembershipsStatement from './surql/departing-memberships.surql'
import memberRemoveStatement from './surql/member-remove.surql'
import membershipAddStatement from './surql/membership-add.surql'
import membershipRemoveStatement from './surql/membership-remove.surql'
import membershipsOfStatement from './surql/memberships-of.surql'
import tenantRemoveStatement from './surql/tenant-remove.surql'

afterEach(closeDepartures)

const lastAdmin = { kind: 'refused', code: 'last-admin' }

describe('AccountDeparture', () => {
  it('takes an organisation the identity is the only member of whole: its database, its row and its membership, and its key is free again', async () => {
    const {
      organisations,
      departure,
      opened,
      ann,
      bob,
      founded,
      membersIn,
      definitionOf,
      tenantRowOf,
      rolesIn,
    } = await departureHarness()

    await founded(ann, 't1')

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t1')).toBeUndefined()
    expect(await tenantRowOf('t1')).toEqual([])
    expect(await rolesIn(ann, 't1')).toEqual([])
    expect(await organisations.membershipsOf(ann)).toEqual(ok([]))

    // The cached connection went with the database: the next one is opened anew.
    expect(opened).toEqual(['t1'])
    expect(await membersIn('t1')).toEqual([])
    expect(opened).toEqual(['t1', 't1'])

    const again = await founded(bob, 't1')

    expect(again.tenant.key).toBe('t1')
    expect(await membersIn('t1')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('is blocked while the identity is the only admin of a ready organisation with other members, and a departure then is refused, changing nothing', async () => {
    const { organisations, departure, ann, bob, founded, invited, everything, definitionOf } =
      await departureHarness()

    await founded(ann, 't1')
    await founded(ann, 't2')
    await invited(ann, 't2', 'bob@example.test')

    expect(await departure.blocked(ann)).toEqual(ok(true))
    expect(await departure.blocked(bob)).toEqual(ok(false))
    expect((await organisations.leaveAll(ann))._unsafeUnwrapErr()).toEqual(lastAdmin)
    // Not even the organisation it alone belongs to went.
    expect(await everything()).toEqual({ tenants: ['t1', 't2'], memberships: 3 })
    expect(await definitionOf('t1')).toBeDefined()
  })

  it('takes the identity out of an organisation others belong to: its membership and member row go, the others and its notes stay', async () => {
    const {
      organisations,
      departure,
      ann,
      bob,
      founded,
      invited,
      membersIn,
      notesIn,
      noted,
      definitionOf,
      rolesIn,
    } = await departureHarness()
    const t3 = await founded(bob, 't3')

    await invited(bob, 't3', 'ann@example.test')
    await noted('t3', ann, 'written by ann')

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await rolesIn(bob, 't3')).toEqual(['admin'])
    expect(await organisations.membershipsOf(bob)).toEqual(ok([t3]))
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
    expect(await notesIn('t3')).toEqual([{ author: ann, text: 'written by ann' }])
    expect(await definitionOf('t3')).toMatch(/^DEFINE DATABASE t_t3 STRICT\b/)
  })

  it('leaves again as a no-op once every membership is gone', async () => {
    const { organisations, ann, bob, founded, invited, membersIn, everything } =
      await departureHarness()

    await founded(ann, 't1')
    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')

    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    const left = await everything()

    expect(left).toEqual({ tenants: ['t3'], memberships: 1 })
    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await everything()).toEqual(left)
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('is not blocked by an organisation that has another admin, which the identity then leaves', async () => {
    const {
      organisations,
      departure,
      directory,
      ann,
      bob,
      cat,
      founded,
      invited,
      membersIn,
      rolesIn,
    } = await departureHarness()

    await founded(ann, 't4')
    await invited(ann, 't4', 'cat@example.test')
    await invited(ann, 't4', 'bob@example.test')
    await directory.db.query(membershipPromote, { identity: recordId('identity', cat), key: 't4' })

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await rolesIn(cat, 't4')).toEqual(['admin'])
    expect(await rolesIn(bob, 't4')).toEqual(['member'])
    expect((await membersIn('t4')).map((row) => row.identity).sort()).toEqual([bob, cat].sort())
  })

  it('counts only ready organisations for the block, and takes one still provisioning whole', async () => {
    const { organisations, departure, directory, ann, founded, invited, definitionOf, everything } =
      await departureHarness()

    await founded(ann, 't5')
    await invited(ann, 't5', 'bob@example.test')
    await directory.db.query(tenantInterrupt, { key: 't5' })
    await founded(ann, 't6')
    await directory.db.query(tenantInterrupt, { key: 't6' })

    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t6')).toBeUndefined()
    expect(await everything()).toEqual({ tenants: ['t5'], memberships: 1 })
  })

  it('completes a departure whose removal of an organisation failed when it runs again', async () => {
    const { organisations, ann, founded, definitionOf, everything, refuse } =
      await departureHarness()

    await founded(ann, 't1')
    refuse(tenantRemoveStatement)

    expect((await organisations.leaveAll(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(await everything()).toEqual({ tenants: ['t1'], memberships: 1 })

    refuse(undefined)

    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await definitionOf('t1')).toBeUndefined()
    expect(await everything()).toEqual({ tenants: [], memberships: 0 })
  })

  it('completes a departure whose removal of a member row failed when it runs again', async () => {
    const { organisations, ann, bob, founded, invited, membersIn, rolesIn, refuse } =
      await departureHarness()

    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')
    refuse(memberRemoveStatement)

    expect((await organisations.leaveAll(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    // The membership stays until the member row went: the next run still finds the organisation.
    expect(await rolesIn(ann, 't3')).toEqual(['member'])

    refuse(undefined)

    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('completes a departure whose removal of a membership failed after the member row went', async () => {
    const { organisations, ann, bob, founded, invited, membersIn, rolesIn, refuse } =
      await departureHarness()

    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')
    refuse(membershipRemoveStatement)

    expect((await organisations.leaveAll(ann))._unsafeUnwrapErr()).toMatchObject({
      code: 'data:WRITE_FAILED',
    })
    expect(await rolesIn(ann, 't3')).toEqual(['member'])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])

    refuse(undefined)

    expect(await organisations.leaveAll(ann)).toEqual(ok(undefined))
    expect(await rolesIn(ann, 't3')).toEqual([])
    expect(await rolesIn(bob, 't3')).toEqual(['admin'])
    expect(await membersIn('t3')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('answers an error, never a guess, for a membership whose organisation is gone', async () => {
    const { organisations, departure, directory, ann } = await departureHarness()

    await directory.db.query(membershipAddStatement, {
      id: membershipIdFactory.create(),
      identity: recordId('identity', ann),
      tenant: recordId('tenant', tenantIdFactory.create()),
      role: 'admin',
    })

    const unknown = {
      code: 'data:QUERY_FAILED',
      message: `the memberships of ${ann} to leave have an unknown shape`,
    }

    expect((await departure.blocked(ann))._unsafeUnwrapErr()).toMatchObject(unknown)
    expect((await organisations.leaveAll(ann))._unsafeUnwrapErr()).toMatchObject(unknown)
  })
})

describe('AccountDeparture beside other changes of the same organisation', () => {
  it('of the two admins departing at once beside a member, one leaves and the other is refused: the member keeps an admin', async () => {
    const {
      organisations,
      departure,
      directory,
      ann,
      bob,
      cat,
      founded,
      invited,
      membersIn,
      rolesIn,
      sentCount,
      hold,
    } = await departureHarness()

    await founded(ann, 't4')
    await invited(ann, 't4', 'cat@example.test')
    await invited(ann, 't4', 'bob@example.test')
    await directory.db.query(membershipPromote, { identity: recordId('identity', cat), key: 't4' })
    expect(await departure.blocked(ann)).toEqual(ok(false))
    expect(await departure.blocked(cat)).toEqual(ok(false))

    const held = hold(memberRemoveStatement)
    const annLeaves = organisations.leaveAll(ann)

    await held.waiting

    const reads = sentCount(departingMembershipsStatement)
    const catLeaves = organisations.leaveAll(cat)

    // Cat's departure reads its organisations while ann is still an admin there.
    await vi.waitFor(() => expect(sentCount(departingMembershipsStatement)).toBe(reads + 1))
    held.release()

    expect(await annLeaves).toEqual(ok(undefined))
    expect((await catLeaves)._unsafeUnwrapErr()).toEqual(lastAdmin)
    expect(await rolesIn(ann, 't4')).toEqual([])
    expect(await rolesIn(cat, 't4')).toEqual(['admin'])
    expect(await rolesIn(bob, 't4')).toEqual(['member'])
    expect((await membersIn('t4')).map((row) => row.identity).sort()).toEqual([bob, cat].sort())
  })

  it('of the two admins departing at once from an organisation of theirs alone, the second takes it whole: nothing is left behind', async () => {
    const {
      organisations,
      directory,
      ann,
      cat,
      founded,
      invited,
      definitionOf,
      everything,
      sentCount,
      hold,
    } = await departureHarness()

    await founded(ann, 't7')
    await invited(ann, 't7', 'cat@example.test')
    await directory.db.query(membershipPromote, { identity: recordId('identity', cat), key: 't7' })

    const held = hold(memberRemoveStatement)
    const annLeaves = organisations.leaveAll(ann)

    await held.waiting

    const reads = sentCount(departingMembershipsStatement)
    const catLeaves = organisations.leaveAll(cat)

    await vi.waitFor(() => expect(sentCount(departingMembershipsStatement)).toBe(reads + 1))
    held.release()

    expect(await annLeaves).toEqual(ok(undefined))
    expect(await catLeaves).toEqual(ok(undefined))
    expect(await everything()).toEqual({ tenants: [], memberships: 0 })
    expect(await definitionOf('t7')).toBeUndefined()
  })

  it('two members departing at once leave the organisation with its admin and nothing of theirs', async () => {
    const {
      organisations,
      ann,
      bob,
      cat,
      founded,
      invited,
      membersIn,
      everything,
      sentCount,
      hold,
    } = await departureHarness()

    await founded(bob, 't5')
    await invited(bob, 't5', 'ann@example.test')
    await invited(bob, 't5', 'cat@example.test')

    const held = hold(memberRemoveStatement)
    const annLeaves = organisations.leaveAll(ann)

    await held.waiting

    const reads = sentCount(departingMembershipsStatement)
    const catLeaves = organisations.leaveAll(cat)

    await vi.waitFor(() => expect(sentCount(departingMembershipsStatement)).toBe(reads + 1))
    held.release()

    expect(await annLeaves).toEqual(ok(undefined))
    expect(await catLeaves).toEqual(ok(undefined))
    expect(await everything()).toEqual({ tenants: ['t5'], memberships: 1 })
    expect(await membersIn('t5')).toEqual([{ identity: bob, role: 'admin' }])
  })

  it('a removal asked by an admin whose departure settled meanwhile is refused, and the member stays', async () => {
    const {
      organisations,
      directory,
      ann,
      bob,
      cat,
      founded,
      invited,
      membersIn,
      rolesIn,
      sentCount,
      hold,
    } = await departureHarness()

    await founded(ann, 't4')
    await invited(ann, 't4', 'cat@example.test')
    await invited(ann, 't4', 'bob@example.test')
    await directory.db.query(membershipPromote, { identity: recordId('identity', cat), key: 't4' })

    const held = hold(memberRemoveStatement)
    const annLeaves = organisations.leaveAll(ann)

    await held.waiting

    const reads = sentCount(membershipsOfStatement)
    const removal = organisations.remove({ actor: ann, key: 't4', identity: bob })

    // The removal found ann an admin before her departure settled.
    await vi.waitFor(() => expect(sentCount(membershipsOfStatement)).toBe(reads + 1))
    held.release()

    expect(await annLeaves).toEqual(ok(undefined))
    expect((await removal)._unsafeUnwrapErr()).toEqual({ kind: 'refused', code: 'not-a-member' })
    expect(await rolesIn(bob, 't4')).toEqual(['member'])
    expect((await membersIn('t4')).map((row) => row.identity).sort()).toEqual([bob, cat].sort())
  })

  it('an invite into an organisation a departure is taking whole is refused once it went', async () => {
    const { organisations, ann, bob, founded, everything, sentCount, hold } =
      await departureHarness()

    await founded(ann, 't1')

    const held = hold(tenantRemoveStatement)
    const annLeaves = organisations.leaveAll(ann)

    await held.waiting

    const lookups = sentCount(identityByEmailStatement)
    const invite = organisations.invite({ actor: ann, key: 't1', email: 'bob@example.test' })

    // The invite found the organisation and bob, and bob again in his turn, before the departure
    // took the organisation.
    await vi.waitFor(() => expect(sentCount(identityByEmailStatement)).toBe(lookups + 2))
    held.release()

    expect(await annLeaves).toEqual(ok(undefined))
    expect((await invite)._unsafeUnwrapErr()).toEqual({ kind: 'refused', code: 'no-such-tenant' })
    expect(await everything()).toEqual({ tenants: [], memberships: 0 })
    expect(await organisations.membershipsOf(bob)).toEqual(ok([]))
  })

  it('a departure asked while an invite into its organisation is under way is refused once the invite made it the last admin', async () => {
    const { organisations, ann, bob, founded, membersIn, rolesIn, sentCount, hold } =
      await departureHarness()

    await founded(ann, 't1')

    const held = hold(membershipAddStatement)
    const invite = organisations.invite({ actor: ann, key: 't1', email: 'bob@example.test' })

    // The invite holds the organisation's turn before bob's membership is written.
    await held.waiting

    const reads = sentCount(departingMembershipsStatement)
    const annLeaves = organisations.leaveAll(ann)

    await vi.waitFor(() => expect(sentCount(departingMembershipsStatement)).toBe(reads + 1))
    held.release()

    expect(await invite).toEqual(
      ok({ identity: { id: bob, email: 'bob@example.test' }, role: 'member' }),
    )
    expect((await annLeaves)._unsafeUnwrapErr()).toEqual(lastAdmin)
    expect(await rolesIn(ann, 't1')).toEqual(['admin'])
    expect(await rolesIn(bob, 't1')).toEqual(['member'])
    expect(await membersIn('t1')).toEqual([
      { identity: ann, role: 'admin' },
      { identity: bob, role: 'member' },
    ])
  })
})

/** Steps of a departure that do nothing, but for `after` when one is named. */
const steps = (after: () => ResultAsync<void, DataError> = () => okAsync(undefined)) => ({
  before: () => okAsync(undefined),
  after,
})

/** A step a test holds: `reached` once it runs, until `release`. */
function heldStep() {
  let release = (): void => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let reached = (): void => {}
  const running = new Promise<void>((resolve) => {
    reached = resolve
  })

  return { gate, running, reached: () => reached(), release: () => release() }
}

describe('Organisations.leaveAll and what runs in its turns', () => {
  it('runs `after` once the identity left, still in its turn: an invite of it asked meanwhile waits, then finds no identity', async () => {
    const { organisations, directory, ann, bob, founded, invited, membersIn, rolesIn, sentCount } =
      await departureHarness()

    await founded(ann, 't1')
    await invited(ann, 't1', 'bob@example.test')

    const held = heldStep()
    /** Bob's roles in t1 as `after` found them. */
    const found: string[][] = []
    const bobLeaves = organisations.leaveAll(
      bob,
      steps(() =>
        ResultAsync.fromSafePromise(
          (async () => {
            found.push(await rolesIn(bob, 't1'))
            held.reached()
            await held.gate
            await directory.db.query(identityForget, { identity: recordId('identity', bob) })
          })(),
        ),
      ),
    )

    await held.running

    const lookups = sentCount(identityByEmailStatement)
    const additions = sentCount(membershipAddStatement)
    const invite = organisations.invite({ actor: ann, key: 't1', email: 'bob@example.test' })

    // The invite finds bob, then waits for `after`: it writes no membership meanwhile.
    await vi.waitFor(() => expect(sentCount(identityByEmailStatement)).toBe(lookups + 1))
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(sentCount(membershipAddStatement)).toBe(additions)

    held.release()

    expect(await bobLeaves).toEqual(ok(undefined))
    expect(found).toEqual([[]])
    expect((await invite)._unsafeUnwrapErr()).toEqual({
      kind: 'refused',
      code: 'no-such-identity',
    })
    expect(sentCount(membershipAddStatement)).toBe(additions)
    expect(await rolesIn(bob, 't1')).toEqual([])
    expect(await membersIn('t1')).toEqual([{ identity: ann, role: 'admin' }])
  })

  it('runs `before` once the departure is allowed and ahead of its writes, and answers what it answers', async () => {
    const { organisations, ann, bob, founded, invited, everything } = await departureHarness()

    await founded(ann, 't1')
    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')

    /** The organisations and memberships as `before` found them. */
    const found: Array<Awaited<ReturnType<typeof everything>>> = []
    const left = await organisations.leaveAll(ann, {
      before: () =>
        ResultAsync.fromSafePromise(
          (async () => {
            found.push(await everything())

            return 'answered by before'
          })(),
        ),
      after: () => okAsync(undefined),
    })

    expect(left).toEqual(ok('answered by before'))
    expect(found).toEqual([{ tenants: ['t1', 't3'], memberships: 3 }])
    expect(await everything()).toEqual({ tenants: ['t3'], memberships: 1 })
  })

  it('changes nothing and runs no `after` when `before` stops the departure, answering its stop', async () => {
    const { organisations, ann, bob, founded, invited, everything, definitionOf } =
      await departureHarness()

    await founded(ann, 't1')
    await founded(bob, 't3')
    await invited(bob, 't3', 'ann@example.test')

    const stop = { kind: 'stopped-by-the-caller' } as const
    let ran = false
    const left = await organisations.leaveAll(ann, {
      before: () => errAsync(stop),
      after: () => {
        ran = true

        return okAsync(undefined)
      },
    })

    expect(left._unsafeUnwrapErr()).toBe(stop)
    expect(ran).toBe(false)
    expect(await everything()).toEqual({ tenants: ['t1', 't3'], memberships: 3 })
    expect(await definitionOf('t1')).toBeDefined()
  })

  it('runs neither step for a departure refused last-admin', async () => {
    const { organisations, ann, founded, invited, everything } = await departureHarness()

    await founded(ann, 't1')
    await invited(ann, 't1', 'bob@example.test')

    const ran: string[] = []
    const refusal = await organisations.leaveAll(ann, {
      before: () => {
        ran.push('before')

        return okAsync(undefined)
      },
      after: () => {
        ran.push('after')

        return okAsync(undefined)
      },
    })

    expect(refusal._unsafeUnwrapErr()).toEqual(lastAdmin)
    expect(ran).toEqual([])
    expect(await everything()).toEqual({ tenants: ['t1'], memberships: 2 })
  })

  it('answers the failure of `after` once the identity left', async () => {
    const { organisations, ann, founded, everything } = await departureHarness()

    await founded(ann, 't1')

    const failure = dataError('data:WRITE_FAILED', 'after failed')

    expect(
      (
        await organisations.leaveAll(
          ann,
          steps(() => errAsync(failure)),
        )
      )._unsafeUnwrapErr(),
    ).toBe(failure)
    expect(await everything()).toEqual({ tenants: [], memberships: 0 })
  })
})
