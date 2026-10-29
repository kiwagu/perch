import { describe, expect, it } from 'vitest'

import { isDestructive, questionCodeOf } from './confirmations'

describe('isDestructive', () => {
  it('knows a delete of the model and a delete, remove or revoke of the platform', () => {
    expect(isDestructive('note.deleteNote')).toBe(true)
    expect(isDestructive('note.delete')).toBe(true)
    expect(isDestructive('platform.organisations.remove')).toBe(true)
    expect(isDestructive('platform.devices.revoke')).toBe(true)
    expect(isDestructive('platform.delete-account')).toBe(true)
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
    expect(questionCodeOf('note.updateNote')).toBeUndefined()
  })
})
