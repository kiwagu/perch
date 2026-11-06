import { errAsync, okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { type DataError, dataError } from '@workspace/data'
import { type IdentityId, identityIdFactory } from '@workspace/ids'
import { FakeLocks, manualClock } from '@workspace/replica/testing'

import type { TenantDatabaseInventory } from '../retained-tenant-databases'
import { memoryStorage, saveDevice } from '../storage'

import { addLeftoverIdentity, leftoverIdentities } from './leftover-identities'
import { DELETE_GRACE_MS, SpaceDeletion } from './space-deletion'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }
const bob = { id: identityIdFactory.create(), email: 'bob@example.test' }

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** The sign-in an ended session came after, on a browser where nobody signed in yet. */
const ENDED = '0'

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

function harness(
  options: { readonly refusedLocal?: readonly IdentityId[]; readonly locks?: FakeLocks } = {},
) {
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
    locks: options.locks ?? new FakeLocks(),
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
    const answer = deletion.destroy(spaceOf(ann, deleting.promise), ENDED)

    expect(leftoverIdentities(storage)).toEqual([ann.id])
    await settle()

    deleting.resolve()

    expect((await answer)._unsafeUnwrap()).toBe('deleted')
    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('answers `pending` when another tab still holds the delete after the grace, and lists the identity until it ends', async () => {
    const { storage, clock, deletion } = harness()
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise), ENDED)

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
      ENDED,
    )

    expect(answer._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(leftoverIdentities(storage)).toEqual([ann.id])
    expect(failures).toEqual([])
  })

  it('reports a delete that fails once the grace passed, as nobody waits for it any more', async () => {
    const { clock, deletion, failures } = harness()
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise), ENDED)

    await settle()

    await clock.advance(DELETE_GRACE_MS)
    expect((await answer)._unsafeUnwrap()).toBe('pending')

    deleting.reject(new Error('the store is broken'))
    await settle()

    expect(failures.map(({ code }) => code)).toEqual(['data:WRITE_FAILED'])
  })

  it('opens an identity again only once its delete under way, in any tab, has ended', async () => {
    // Two tabs of one browser share its locks and its storage.
    const locks = new FakeLocks()
    const { storage, clock, deletion } = harness({ locks })
    const other = new SpaceDeletion({
      storage,
      clock,
      locks,
      deleteLocal: () => okAsync(undefined),
      deleteTenantLocal: () => okAsync(undefined),
      inventory: () => ({
        keys: () => [],
        add: () => {},
        drop: () => {},
        savedMemberships: () => [],
      }),
      onError: () => {},
    })
    const deleting = deferred()
    const answer = deletion.destroy(spaceOf(ann, deleting.promise), ENDED)

    await settle()
    await clock.advance(DELETE_GRACE_MS)
    expect((await answer)._unsafeUnwrap()).toBe('pending')

    let opened = false
    const opening = other.open(ann.id, () => {
      opened = true

      return okAsync('open')
    })

    await settle()
    expect(opened).toBe(false)

    deleting.resolve()

    expect((await opening)._unsafeUnwrap()).toBe('open')
    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('deletes nothing of an identity signed in again before its delete took the lock: its databases are in use', async () => {
    const { storage, deletion } = harness()
    let destroyed = false

    saveDevice(storage, { identity: ann, token: 't', memberships: [] })

    const answer = await deletion.destroy(
      {
        identity: ann,
        close: () => Promise.resolve(),
        destroy: () => {
          destroyed = true

          return Promise.resolve()
        },
      },
      ENDED,
    )

    expect(answer._unsafeUnwrap()).toBe('in-use')
    expect(destroyed).toBe(false)
    // Listed until the sign-in that saved it opens the space.
    expect(leftoverIdentities(storage)).toEqual([ann.id])
  })

  it('keeps listed an identity whose delete it skipped for a sign-in whose open then failed', async () => {
    const { storage, deletion } = harness()

    saveDevice(storage, { identity: ann, token: 't', memberships: [] })

    expect((await deletion.deleteUnopened(ann.id, ENDED))._unsafeUnwrap()).toBe('in-use')

    const opened = await deletion.open(ann.id, () =>
      ResultAsync.fromPromise(Promise.reject(new Error('broken')), () =>
        dataError('data:OPEN_FAILED', 'the database does not open'),
      ),
    )

    expect(opened.isErr()).toBe(true)
    expect(leftoverIdentities(storage)).toEqual([ann.id])
  })

  it('keeps listed an identity whose space destroyed itself but left an organisation database counted', async () => {
    const { storage, deletion, inventory } = harness()

    inventory(ann.id).add(['acme'])

    const answer = await deletion.destroy(spaceOf(ann, Promise.resolve()), ENDED)

    expect(answer._unsafeUnwrapErr().code).toBe('data:WRITE_FAILED')
    expect(leftoverIdentities(storage)).toEqual([ann.id])
  })

  it('starts the grace once the space closed: a slow close is no held-up delete', async () => {
    const { clock, deletion } = harness()
    const closing = deferred()
    const answer = deletion.destroy(
      { identity: ann, close: () => closing.promise, destroy: () => closing.promise },
      ENDED,
    )

    await clock.advance(DELETE_GRACE_MS * 2)
    closing.resolve()

    expect((await answer)._unsafeUnwrap()).toBe('deleted')
  })

  it('takes an identity off the list once its space opened: its databases are in use', async () => {
    const { storage, deletion } = harness()

    addLeftoverIdentity(storage, ann.id)

    expect((await deletion.open(ann.id, () => okAsync(undefined))).isOk()).toBe(true)
    expect(leftoverIdentities(storage)).toEqual([])
  })

  it('keeps an identity listed when its space does not open, for the next start to delete', async () => {
    const { storage, deletion } = harness()

    addLeftoverIdentity(storage, ann.id)

    const opened = await deletion.open(ann.id, () =>
      ResultAsync.fromPromise(Promise.reject(new Error('broken')), () =>
        dataError('data:OPEN_FAILED', 'the database does not open'),
      ),
    )

    expect(opened._unsafeUnwrapErr().code).toBe('data:OPEN_FAILED')
    expect(leftoverIdentities(storage)).toEqual([ann.id])
  })

  it('deletes what the listed identities left, their own database and every organisation database counted for them, except the one signed in', async () => {
    const { storage, deletion, localsDeleted, tenantsDeleted, inventory } = harness()

    addLeftoverIdentity(storage, ann.id)
    addLeftoverIdentity(storage, bob.id)
    inventory(ann.id).add(['acme', 'globex'])
    saveDevice(storage, { identity: bob, token: 't', memberships: [] })

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
