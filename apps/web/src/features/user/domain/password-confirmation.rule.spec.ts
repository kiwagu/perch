import { describe, expect, it } from 'vitest'

import { checkPasswordConfirmation } from './password-confirmation.rule'

describe('checkPasswordConfirmation', () => {
  it('finds the password typed again the same as the password', () => {
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 'secret-ann' })).toBe(
      'same',
    )
    expect(checkPasswordConfirmation({ password: '', confirmation: '' })).toBe('same')
  })

  it('lets it follow while it is how the password begins, a part of it or nothing yet', () => {
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 'secret-an' })).toBe(
      'following',
    )
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 's' })).toBe(
      'following',
    )
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: '' })).toBe(
      'following',
    )
  })

  it('finds it strayed once a character differs or it is longer than the password', () => {
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 'secret-b' })).toBe(
      'strayed',
    )
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 'Secret' })).toBe(
      'strayed',
    )
    expect(checkPasswordConfirmation({ password: 'secret-ann', confirmation: 'secret-ann!' })).toBe(
      'strayed',
    )
    expect(checkPasswordConfirmation({ password: '', confirmation: 'x' })).toBe('strayed')
  })
})
