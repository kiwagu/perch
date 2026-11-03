import { describe, expect, it } from 'vitest'

import { memoryStorage } from './key-value'
import { forgetNotice, savedNotice, saveNotice } from './notice'

describe('the word for the sign-in page', () => {
  it('keeps each notice it knows, and reads none from a value it does not', () => {
    const storage = memoryStorage()

    saveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('signed-out-elsewhere')

    saveNotice(storage, 'resend-after-sign-in')

    expect(savedNotice(storage)).toBe('resend-after-sign-in')

    saveNotice(storage, 'password-reset-elsewhere')

    expect(savedNotice(storage)).toBe('password-reset-elsewhere')

    forgetNotice(storage)

    expect(savedNotice(storage)).toBeUndefined()

    storage.set('perch.session.notice', 'something-else')

    expect(savedNotice(storage)).toBeUndefined()
  })
})
