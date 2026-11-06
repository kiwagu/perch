import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import { FakeLocks, manualClock } from '@workspace/replica/testing'

import { dropNotice, memoryStorage, savedNotice, saveNotice } from '../storage'

import { DELETE_GRACE_MS, type DeleteOutcome, SpaceDeletion } from './space-deletion'

const ann = { id: identityIdFactory.create(), email: 'ann@example.test' }

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0))

/** What another tab that never lets the databases go leaves a delete: an answer that never comes. */
const heldUp = () => new Promise<void>(() => {})

/** A tab's deletion of ann's databases, which another tab holds up for good, on one browser. */
function browser() {
  const storage = memoryStorage()
  const clock = manualClock()
  const deletion = new SpaceDeletion({
    storage,
    clock,
    locks: new FakeLocks(),
    deleteLocal: () => new ResultAsync<void, DataError>(new Promise(() => {})),
    deleteTenantLocal: () => okAsync(undefined),
    inventory: () => ({
      keys: () => [],
      add: () => {},
      drop: () => {},
      savedMemberships: () => [],
    }),
    onError: () => {},
  })
  /** Ann's open space, closing once `closed` settles. */
  const space = (closed: Promise<void> = Promise.resolve()) => ({
    identity: ann,
    close: () => closed,
    destroy: heldUp,
  })

  /** The grace passes: the delete answers `pending`. */
  const graceEnds = async (answer: ResultAsync<DeleteOutcome, DataError>) => {
    await settle()
    await clock.advance(DELETE_GRACE_MS)
    expect((await answer)._unsafeUnwrap()).toBe('pending')
  }

  return { storage, deletion, space, graceEnds }
}

describe('the word a delete held up past the grace leaves the sign-in page', () => {
  it('says the data goes once the other tabs close, for an open space and for one that did not open', async () => {
    for (const deleting of ['open', 'unopened'] as const) {
      const { storage, deletion, space, graceEnds } = browser()

      await graceEnds(
        deleting === 'open' ? deletion.destroy(space()) : deletion.deleteUnopened(ann.id),
      )

      expect(savedNotice(storage)).toBe('delete-pending')
    }
  })

  it('leaves no word once an account signed in on the browser after the session ended', async () => {
    for (const deleting of ['open', 'unopened'] as const) {
      const { storage, deletion, space, graceEnds } = browser()
      const answer =
        deleting === 'open' ? deletion.destroy(space()) : deletion.deleteUnopened(ann.id)

      // An account signs in in another tab while the delete waits: the frames drop the words.
      dropNotice(storage)
      await graceEnds(answer)

      expect(savedNotice(storage)).toBeUndefined()
    }
  })

  it('keeps the word of a session that signed in and ended since, not the word of the one before', async () => {
    const { storage, deletion, space, graceEnds } = browser()
    const answer = deletion.destroy(space())

    dropNotice(storage)
    // That session ends too, from another device, before the grace passes.
    saveNotice(storage, 'password-changed-elsewhere')
    await graceEnds(answer)

    expect(savedNotice(storage)).toBe('password-changed-elsewhere')
  })

  it('counts the session as ended from the delete on, while its space still closes', async () => {
    const { storage, deletion, space, graceEnds } = browser()
    let close = () => {}
    const closed = new Promise<void>((resolve) => {
      close = resolve
    })
    const answer = deletion.destroy(space(closed))

    // The keys are gone as the delete begins: another tab may sign an account in at once.
    dropNotice(storage)
    close()
    await graceEnds(answer)

    expect(savedNotice(storage)).toBeUndefined()
  })
})
