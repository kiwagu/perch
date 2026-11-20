import { describe, expect, it } from 'vitest'

import { isDestructive, questionCodeOf } from './confirmations'

describe('isDestructive', () => {
  it('knows a delete of the model and a ban, delete, remove or revoke of the platform', () => {
    expect(isDestructive('note.deleteNote')).toBe(true)
    expect(isDestructive('note.delete')).toBe(true)
    expect(isDestructive('platform.organisations.remove')).toBe(true)
    expect(isDestructive('platform.devices.revoke')).toBe(true)
    expect(isDestructive('platform.delete-account')).toBe(true)
    expect(isDestructive('platform.accounts.ban')).toBe(true)
    expect(isDestructive('platform.accounts.revoke-sessions')).toBe(true)
  })

  it('reads the verb as a whole word, so an unban or a banish asks nothing', () => {
    expect(isDestructive('platform.accounts.unban')).toBe(false)
    expect(isDestructive('platform.accounts.banish')).toBe(false)
    expect(isDestructive('note.banNote')).toBe(false)
  })

  it('leaves every other action alone', () => {
    expect(isDestructive('note.createNote')).toBe(false)
    expect(isDestructive('note.updateNote')).toBe(false)
    expect(isDestructive('platform.sign-out')).toBe(false)
    expect(isDestructive('platform.sign-out-everywhere')).toBe(false)
    expect(isDestructive('platform.organisations.select')).toBe(false)
    expect(isDestructive('thing.deleted')).toBe(false)
  })
})

describe('questionCodeOf', () => {
  it('names the object, then the verb, for an action of the model', () => {
    expect(questionCodeOf('note.deleteNote')).toBe('note-delete')
    expect(questionCodeOf('note.deleteNoteItem')).toBe('note-item-delete')
    expect(questionCodeOf('note.delete')).toBe('note-delete')
  })

  it('names a platform action by its name, and nothing that is not destructive', () => {
    expect(questionCodeOf('platform.organisations.remove')).toBe('organisations-remove')
    expect(questionCodeOf('platform.devices.revoke')).toBe('devices-revoke')
    expect(questionCodeOf('platform.accounts.ban')).toBe('accounts-ban')
    expect(questionCodeOf('platform.accounts.revoke-sessions')).toBe('accounts-revoke-sessions')
    expect(questionCodeOf('platform.accounts.unban')).toBeUndefined()
    expect(questionCodeOf('note.updateNote')).toBeUndefined()
  })
})
