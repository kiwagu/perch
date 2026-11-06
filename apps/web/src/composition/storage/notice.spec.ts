import { describe, expect, it } from 'vitest'

import { SESSION_NOTICES } from '../../platform/session.port'

import { memoryStorage } from './key-value'
import { dropNotice, forgetNotice, noticeMark, savedNotice, saveNotice } from './notice'

const PAIRS = SESSION_NOTICES.flatMap((first) =>
  SESSION_NOTICES.map((then) => [first, then] as const),
)

describe('the word for the sign-in page', () => {
  it('keeps each notice it knows, and reads none from a value it does not', () => {
    const storage = memoryStorage()

    for (const notice of SESSION_NOTICES) {
      saveNotice(storage, notice)

      expect(savedNotice(storage)).toBe(notice)

      forgetNotice(storage)

      expect(savedNotice(storage)).toBeUndefined()
    }

    storage.set('perch.session.notice', 'something-else')

    expect(savedNotice(storage)).toBeUndefined()
  })

  it.each(PAIRS)('keeps the first by the rank of %s and %s written in turn', (first, then) => {
    const storage = memoryStorage()

    saveNotice(storage, first)
    saveNotice(storage, then)

    expect(savedNotice(storage)).toBe(
      SESSION_NOTICES.indexOf(first) <= SESSION_NOTICES.indexOf(then) ? first : then,
    )
  })

  it('drops the word, and a word raised before that is written later, but keeps one raised after', () => {
    const storage = memoryStorage()

    saveNotice(storage, 'signed-out-elsewhere')

    const before = noticeMark(storage)

    dropNotice(storage)

    expect(savedNotice(storage)).toBeUndefined()

    saveNotice(storage, 'delete-pending', before)

    expect(savedNotice(storage)).toBeUndefined()

    saveNotice(storage, 'password-changed-elsewhere')

    expect(savedNotice(storage)).toBe('password-changed-elsewhere')
  })

  it('moves the mark on each drop, from a value it does not know too, and never on a take', () => {
    const storage = memoryStorage()
    const first = noticeMark(storage)

    forgetNotice(storage)

    expect(noticeMark(storage)).toBe(first)

    for (const kept of [undefined, '41', 'something-else']) {
      if (kept !== undefined) {
        storage.set('perch.session.notice-dropped', kept)
      }

      const before = noticeMark(storage)

      dropNotice(storage)

      expect(noticeMark(storage)).not.toBe(before)
    }
  })
})
