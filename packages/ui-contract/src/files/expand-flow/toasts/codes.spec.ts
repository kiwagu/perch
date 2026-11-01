import { describe, expect, it } from 'vitest'

import { operationCodeOf, toastCodeOf } from './codes'

describe('toastCodeOf', () => {
  it('names the object, then the past of create, update or delete', () => {
    expect(toastCodeOf('note.createNote')).toBe('note-created')
    expect(toastCodeOf('note.updateNote')).toBe('note-updated')
    expect(toastCodeOf('note.deleteNote')).toBe('note-deleted')
    expect(toastCodeOf('profile.updateBio')).toBe('bio-updated')
    expect(toastCodeOf('settings.updateLocaleChoice')).toBe('locale-choice-updated')
  })

  it('says another verb is done, and a platform action has no toast', () => {
    expect(toastCodeOf('organisation.inviteMember')).toBe('invite-member-done')
    expect(toastCodeOf('thing.publish')).toBe('publish-done')
    expect(toastCodeOf('platform.organisations.invite')).toBeUndefined()
  })

  it('reads a verb only from its own table, never from what every object inherits', () => {
    expect(toastCodeOf('thing.constructorThing')).toBe('constructor-thing-done')
    expect(toastCodeOf('thing.toStringThing')).toBe('to-string-thing-done')
  })
})

describe('operationCodeOf', () => {
  it("names the screen's last segment, then the control's verb in the past, for a control of the screen itself", () => {
    expect(operationCodeOf('user.profile.save-button', 'user.profile')).toBe('profile-saved')
    expect(operationCodeOf('device.revoke-all-button', 'device')).toBe('device-revoked-all')
  })

  it('names the part a control sits in', () => {
    expect(operationCodeOf('organisation.notes.add-button', 'organisation')).toBe('notes-added')
  })
})
