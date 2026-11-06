import { describe, expect, it } from 'vitest'

import { SESSION_NOTICES } from '../../platform/session.port'

import { memoryStorage } from './key-value'
import { forgetNotice, markSignIn, savedNotice, saveNotice, signInMark } from './notice'

const PAIRS = SESSION_NOTICES.flatMap((first) =>
  SESSION_NOTICES.map((then) => [first, then] as const),
)

describe('the words for the sign-in page', () => {
  it('keeps each notice it knows until the page takes them, and reads none from a value naming no sign-in', () => {
    const storage = memoryStorage()

    for (const notice of SESSION_NOTICES) {
      saveNotice(storage, notice)

      expect(savedNotice(storage)).toBe(notice)

      forgetNotice(storage)

      expect(savedNotice(storage)).toBeUndefined()
    }

    storage.set('perch.session.notice.signed-out-elsewhere', 'something-else')

    expect(savedNotice(storage)).toBeUndefined()
  })

  it.each(PAIRS)('says the first by the rank of %s and %s written in turn', (first, then) => {
    const storage = memoryStorage()

    saveNotice(storage, first)
    saveNotice(storage, then)

    expect(savedNotice(storage)).toBe(
      SESSION_NOTICES.indexOf(first) <= SESSION_NOTICES.indexOf(then) ? first : then,
    )
  })

  it('ends every word at a sign-in, and a word raised before it that is written later, but keeps one raised after', () => {
    const storage = memoryStorage()

    saveNotice(storage, 'signed-out-elsewhere')

    const ended = signInMark(storage)

    markSignIn(storage)

    expect(savedNotice(storage)).toBeUndefined()

    saveNotice(storage, 'delete-pending', ended)

    expect(savedNotice(storage)).toBeUndefined()

    saveNotice(storage, 'password-changed-elsewhere')

    expect(savedNotice(storage)).toBe('password-changed-elsewhere')
  })

  it('says no word another tab wrote as it lost a race with a sign-in, and loses no word to another tab', () => {
    const storage = memoryStorage()
    const ended = signInMark(storage)

    markSignIn(storage)
    // Another tab read the mark before the sign-in moved it, and writes once it moved.
    storage.set('perch.session.notice.delete-pending', ended)

    expect(savedNotice(storage)).toBeUndefined()

    // Two tabs leave words of one ending, the higher one first: the lower one replaces nothing.
    saveNotice(storage, 'resend-after-sign-in')
    saveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('resend-after-sign-in')
  })

  it('moves the mark at each sign-in, from a value it does not know too, and never as the page takes the words', () => {
    const storage = memoryStorage()
    const first = signInMark(storage)

    forgetNotice(storage)

    expect(signInMark(storage)).toBe(first)

    for (const kept of [undefined, '41', 'something-else']) {
      if (kept !== undefined) {
        storage.set('perch.session.sign-ins', kept)
      }

      const before = signInMark(storage)

      markSignIn(storage)

      expect(signInMark(storage)).not.toBe(before)
    }
  })
})
