import { errAsync, okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { manualClock } from '@workspace/replica/testing'

import { addLeftoverIdentity, leftoverIdentities } from './leftover-identities'
import type { TenantDatabaseInventory } from './retained-tenant-databases'
import { DELETE_GRACE_MS, SpaceDeletion } from './space-deletion'
import { memoryStorage, saveDevice } from './storage'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob = { id: identityIdFactory.create(), email: 'bob@example.test' }

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** A promise and the functions that settle it. */
function deferred() {
  let resolve: () => void = () => {}
  let reject: (cause: unknown) => void = () => {}
  const promise = new Promise<void>((yes, no) => {
    resolve = yes
    reject = no
  })

  return { promise, resolve, reject }
}

/** A space that closes at once and whose `destroy` settles with `deleting`. */
const spaceOf = (identity: typeof ann, deleting: Promise<void>) => ({
  identity,
  close: () => Promise.resolve(),
  destroy: () => deleting,
})

function harness(options: { readonly refusedLocal?: readonly IdentityId[] } = {}) {
  const storage = memoryStorage()
  const clock = manualClock()
  const failures: DataError[] = []
  const localsDeleted: IdentityId[] = []
  const tenantsDeleted: string[] = []
  const counted = new Map<IdentityId, string[]>()
  const inventory = (identity: IdentityId): TenantDatabaseInventory => ({
    keys: () => counted.get(identity) ?? [],
    add: (keys) => counted.set(identity, [...(counted.get(identity) ?? []), ...keys]),
    drop: (keys) =>
      counted.set(
        identity,
        (counted.get(identity) ?? []).filter((key) => !keys.includes(key)),
      ),
    savedMemberships: () => [],
  })
  const deletion = new SpaceDeletion({
    storage,
    clock,
    deleteLocal: (identity) => {
      if (options.refusedLocal?.includes(identity)) {
        return errAsync(dataError('data:WRITE_FAILED', 'the browser would not delete it'))
      }

      localsDeleted.push(identity)

      return okAsync(undefined)
    },
    deleteTenantLocal: (identity, key) => {
      tenantsDeleted.push(`${identity}/${key}`)

      return okAsync(undefined)
    },
    inventory,
    onError: (error) => failures.push(error),
  })

  return { storage, clock, failures, localsDeleted, tenantsDeleted, inventory, deletion }
}

describe('SpaceDeletion', () => {
  it('answers `deleted` once the space is gone within the grace, listing the identity only meanwhile', async () => {
    const { storage, deletion } = harness()
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise))

    expect(leftoverIdentities(storage)).toEqual([ann.id])
    await settle()

    deleting.resolve()

    expect((await answer)._unsafeUnwrap()).toBe('deleted')
    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('answers `pending` when another tab still holds the delete after the grace, and lists the identity until it ends', async () => {
    const { storage, clock, deletion } = harness()
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise))

    await settle()

    await clock.advance(DELETE_GRACE_MS - 1)
    await settle()

    let answered: string | undefined

    void answer.match(
      (outcome) => {
        answered = outcome
      },
      () => {},
    )
    await settle()

    expect(answered).toBeUndefined()

    await clock.advance(1)

    expect((await answer)._unsafeUnwrap()).toBe('pending')
    expect(leftoverIdentities(storage)).toEqual([ann.id])

    deleting.resolve()
    await settle()

    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('fails a delete that fails within the grace, and keeps the identity listed for the next start', async () => {
    const { storage, deletion, failures } = harness()
    const answer = await deletion.destroy(
      spaceOf(ann, Promise.reject(new Error('the store is broken'))),
    )

    expect(answer._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(leftoverIdentities(storage)).toEqual([ann.id])
    expect(failures).toEqual([])
  })

  it('reports a delete that fails once the grace passed, as nobody waits for it any more', async () => {
    const { clock, deletion, failures } = harness()
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise))

    await settle()

    await clock.advance(DELETE_GRACE_MS)
    expect((await answer)._unsafeUnwrap()).toBe('pending')

    deleting.reject(new Error('the store is broken'))
    await settle()

    expect(failures.map(({ code }) => code)).toEqual(['data:WRITE_FAILED'])
  })

  it('has an identity opened again wait for its delete this page runs, and lists it no more', async () => {
    const { storage, clock, deletion } = harness()
    const deleting = deferred()

    const answer = deletion.destroy(spaceOf(ann, deleting.promise))

    await settle()
    await clock.advance(DELETE_GRACE_MS)
    expect((await answer)._unsafeUnwrap()).toBe('pending')

    let opened = false
    const opening = deletion.beforeOpen(ann.id).then(() => {
      opened = true
    })

    await settle()
    expect(opened).toBe(false)

    deleting.resolve()
    await opening

    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('starts the grace once the space closed: a slow close is no held-up delete', async () => {
    const { clock, deletion } = harness()
    const closing = deferred()
    const answer = deletion.destroy({
      identity: ann,
      close: () => closing.promise,
      destroy: () => closing.promise,
    })

    await clock.advance(DELETE_GRACE_MS * 2)
    closing.resolve()

    expect((await answer)._unsafeUnwrap()).toBe('deleted')
  })

  it('takes an identity opened without a delete running off the list: its databases are in use', async () => {
    const { storage, deletion } = harness()

    addLeftoverIdentity(storage, ann.id)
    await deletion.beforeOpen(ann.id)

    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('deletes what the listed identities left, their own database and every organisation database counted for them, except the one signed in', async () => {
    const { storage, deletion, localsDeleted, tenantsDeleted, inventory } = harness()

    addLeftoverIdentity(storage, ann.id)
    addLeftoverIdentity(storage, bob.id)
    inventory(ann.id).add(['acme', 'globex'])
    saveDevice(storage, { identity: bob, tokens: { access: 'a', refresh: 'r' }, memberships: [] })

    await deletion.deleteLeftovers()

    expect(localsDeleted).toEqual([ann.id])
    expect(tenantsDeleted).toEqual([`${ann.id}/acme`, `${ann.id}/globex`])
    expect(inventory(ann.id).keys()).toEqual([])
    expect(leftoverIdentities(storage)).toEqual([bob.id])
  })

  it('keeps listed, and reports, an identity whose database could not be deleted', async () => {
    const { storage, deletion, failures } = harness({ refusedLocal: [ann.id] })

    addLeftoverIdentity(storage, ann.id)
    await deletion.deleteLeftovers()

    expect(leftoverIdentities(storage)).toEqual([ann.id])
    expect(failures.map(({ code }) => code)).toEqual(['data:WRITE_FAILED'])
  })
})
