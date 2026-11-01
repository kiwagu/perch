import { describe, expect, it } from 'vitest'

import { anchorDefSchema, authoredAnchorDefSchema } from './anchor'

const button = (binding: unknown) => ({ kind: 'button', binding })

const action = (params: Record<string, unknown>) => ({ action: 'thing.updateThing', params })

describe('anchorDefSchema binding', () => {
  it('accepts a single binding', () => {
    expect(anchorDefSchema.safeParse(button({ model: 'thing.title' })).success).toBe(true)
  })
  it('accepts several bindings, run in order or chosen by the mode', () => {
    const parsed = anchorDefSchema.safeParse(
      button([
        { action: 'profile.updateName', params: { name: 'user.profile.name-input' } },
        { action: 'profile.updateBio', params: { bio: 'user.profile.bio-textarea' } },
      ]),
    )

    expect(parsed.success).toBe(true)
  })
  it('refuses an empty list of bindings', () => {
    expect(anchorDefSchema.safeParse(button([])).success).toBe(false)
  })
  it('accepts a search parameter a field starts with, alone or beside its action', () => {
    const input = (binding: unknown) => ({ kind: 'input', binding })

    expect(anchorDefSchema.safeParse(input({ search: 'email' })).success).toBe(true)
    expect(
      anchorDefSchema.safeParse(
        input([
          { search: 'email' },
          {
            action: 'platform.request-password-reset',
            params: { email: 'user.forgot.email-input' },
          },
        ]),
      ).success,
    ).toBe(true)
    expect(anchorDefSchema.safeParse(input({ search: 'Email-1' })).success).toBe(false)
    expect(anchorDefSchema.safeParse(input({ search: 'email', value: 'x' })).success).toBe(false)
  })
})

describe('action params', () => {
  it('accepts an anchor or a constant value', () => {
    for (const value of [true, 3, 'all']) {
      expect(anchorDefSchema.safeParse(button(action({ forgetUnsent: { value } }))).success).toBe(
        true,
      )
    }

    expect(anchorDefSchema.safeParse(button(action({ title: 'sample.title-input' }))).success).toBe(
      true,
    )
  })
  it('refuses a constant that is not a primitive, and any other object', () => {
    expect(anchorDefSchema.safeParse(button(action({ flag: { value: {} } }))).success).toBe(false)
    expect(anchorDefSchema.safeParse(button(action({ flag: { other: 1 } }))).success).toBe(false)
  })
  it('accepts a search parameter of the route by its name', () => {
    expect(anchorDefSchema.safeParse(button(action({ title: { search: 'token' } }))).success).toBe(
      true,
    )
    expect(
      anchorDefSchema.safeParse(button(action({ title: { search: 'Token-1' } }))).success,
    ).toBe(false)
    expect(
      anchorDefSchema.safeParse(button(action({ title: { search: 'token', value: 1 } }))).success,
    ).toBe(false)
  })
})

describe('the question before a destructive action', () => {
  const deleting = button({ action: 'note.deleteNote', params: { id: 'sample.item' } })
  const asks = { dialog: 'app-shell.confirmation', code: 'note-delete' }

  it('carries the derived question, never the ban, as every reader takes it', () => {
    expect(anchorDefSchema.safeParse({ ...deleting, asks }).success).toBe(true)
    expect(anchorDefSchema.safeParse({ ...deleting, confirm: false }).success).toBe(false)
  })

  it('takes the ban as a screen file writes it, and no other value, nor the derived question', () => {
    expect(authoredAnchorDefSchema.safeParse({ ...deleting, confirm: false }).success).toBe(true)
    expect(authoredAnchorDefSchema.safeParse({ ...deleting, confirm: true }).success).toBe(false)
    expect(authoredAnchorDefSchema.safeParse({ ...deleting, asks }).success).toBe(false)
  })
})
