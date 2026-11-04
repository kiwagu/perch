import { describe, expect, it } from 'vitest'

import { memoryStorage } from './key-value'
import { PASSWORD_RESET_KEY, savePasswordReset } from './password-reset'

describe('a password reset done in this tab', () => {
  it('writes a new value on every reset, so each one changes the key', () => {
    const storage = memoryStorage()

    savePasswordReset(storage)

    const first = storage.get(PASSWORD_RESET_KEY)

    savePasswordReset(storage)

    expect(first).toBeDefined()
    expect(storage.get(PASSWORD_RESET_KEY)).toBeDefined()
    expect(storage.get(PASSWORD_RESET_KEY)).not.toBe(first)
  })
})
