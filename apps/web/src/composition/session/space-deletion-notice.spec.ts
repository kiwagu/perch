import { okAsync, ResultAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import type { DataError } from '@workspace/data'
import { identityIdFactory } from '@workspace/ids'
import { FakeLocks, manualClock } from '@workspace/replica/testing'

import { markSignIn, memoryStorage, savedNotice, saveNotice, signInMark } from '../storage'

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
      const ended = signInMark(storage)

      await graceEnds(
        deleting === 'open'
          ? deletion.destroy(space(), ended)
          : deletion.deleteUnopened(ann.id, ended),
      )

      expect(savedNotice(storage)).toBe('delete-pending')
    }
  })

  it('leaves no word once an account signed in on the browser after the session ended', async () => {
    for (const deleting of ['open', 'unopened'] as const) {
      const { storage, deletion, space, graceEnds } = browser()
      const ended = signInMark(storage)
      const answer =
        deleting === 'open'
          ? deletion.destroy(space(), ended)
          : deletion.deleteUnopened(ann.id, ended)

      // An account signs in in another tab while the delete waits.
      markSignIn(storage)
      await graceEnds(answer)

      expect(savedNotice(storage)).toBeUndefined()
    }
  })

  it('keeps the word of a session that signed in and ended since, not the word of the one before', async () => {
    const { storage, deletion, space, graceEnds } = browser()
    const answer = deletion.destroy(space(), signInMark(storage))

    markSignIn(storage)
    // That session ends too, from another device, before the grace passes.
    saveNotice(storage, 'password-changed-elsewhere')
    await graceEnds(answer)

    expect(savedNotice(storage)).toBe('password-changed-elsewhere')
  })

  it('leaves no word for a session that ended before a sign-in made while it waited to delete', async () => {
    const { storage, deletion, space, graceEnds } = browser()
    // The session ends; its sign-out waits for the other tabs' writes, and an account signs in
    // and out meanwhile, before the delete begins.
    const ended = signInMark(storage)

    markSignIn(storage)

    await graceEnds(deletion.destroy(space(), ended))

    expect(savedNotice(storage)).toBeUndefined()
  })
})
