import { describe, expect, it } from 'vitest'

import { memoryStorage } from './key-value'
import { forgetNotice, leaveNotice, savedNotice, saveNotice } from './notice'

describe('the word for the sign-in page', () => {
  it('keeps each notice it knows, and reads none from a value it does not', () => {
    const storage = memoryStorage()

    saveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('signed-out-elsewhere')

    saveNotice(storage, 'resend-after-sign-in')

    expect(savedNotice(storage)).toBe('resend-after-sign-in')

    saveNotice(storage, 'password-reset-elsewhere')

    expect(savedNotice(storage)).toBe('password-reset-elsewhere')

    storage.set('perch.session.notice', 'something-else')

    expect(savedNotice(storage)).toBeUndefined()
  })

  it("leaves a screen's word when none waits, or in place of a word on why the session ended", () => {
    const storage = memoryStorage()

    leaveNotice(storage, 'password-reset-elsewhere')

    expect(savedNotice(storage)).toBe('password-reset-elsewhere')

    saveNotice(storage, 'password-changed-elsewhere')
    leaveNotice(storage, 'password-reset-elsewhere')

    expect(savedNotice(storage)).toBe('password-reset-elsewhere')

    saveNotice(storage, 'signed-out-elsewhere')
    leaveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('signed-out-elsewhere')
  })

  it("keeps a word on what became of the device's data in place of a screen's", () => {
    const storage = memoryStorage()

    saveNotice(storage, 'resend-after-sign-in')
    leaveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('resend-after-sign-in')

    saveNotice(storage, 'delete-pending')
    leaveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('delete-pending')

    forgetNotice(storage)
    leaveNotice(storage, 'signed-out-elsewhere')

    expect(savedNotice(storage)).toBe('signed-out-elsewhere')
  })
})
