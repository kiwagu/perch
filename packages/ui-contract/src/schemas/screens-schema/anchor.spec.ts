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

describe('a secret field', () => {
  it('says secret: true, and no other value', () => {
    const password = { kind: 'input', derived: ['visibility-button'] }

    expect(anchorDefSchema.safeParse({ ...password, secret: true }).success).toBe(true)
    expect(authoredAnchorDefSchema.safeParse({ ...password, secret: true }).success).toBe(true)
    expect(anchorDefSchema.safeParse({ ...password, secret: false }).success).toBe(false)
  })
})

describe('a composite on an anchor', () => {
  it('accepts the opt-in on both schemas, and derivedFrom on the canonical one only', () => {
    const input = { kind: 'input', secret: true, composite: 'password-rules' }
    const item = {
      kind: 'item',
      states: ['met'],
      derivedFrom: { composite: 'password-rules', item: 'length' },
    }
    const list = { kind: 'list', derivedFrom: { composite: 'password-rules' } }

    expect(anchorDefSchema.safeParse(input).success).toBe(true)
    expect(authoredAnchorDefSchema.safeParse(input).success).toBe(true)
    expect(anchorDefSchema.safeParse(item).success).toBe(true)
    expect(anchorDefSchema.safeParse(list).success).toBe(true)
    expect(authoredAnchorDefSchema.safeParse(item).success).toBe(false)
    expect(authoredAnchorDefSchema.safeParse(list).success).toBe(false)
    expect(anchorDefSchema.safeParse({ kind: 'input', composite: 'Password' }).success).toBe(false)
  })
})

describe('a source', () => {
  const list = (source: unknown) => ({ kind: 'list', source })

  it('takes params from the search or as constants, and pages, on a platform source alone', () => {
    expect(
      anchorDefSchema.safeParse(
        list({
          platform: 'accounts.list',
          params: { q: { search: 'q' }, kind: { value: 'all' } },
          paged: true,
        }),
      ).success,
    ).toBe(true)
    expect(anchorDefSchema.safeParse(list({ platform: 'accounts.list' })).success).toBe(true)
  })
  it('refuses a param from a field, a paged that is not true, and either on an entity source', () => {
    for (const source of [
      { platform: 'accounts.list', params: { q: 'console.users.search-input' } },
      { platform: 'accounts.list', params: { q: { anchor: 'console.users.search-input' } } },
      { platform: 'accounts.list', paged: false },
      { platform: 'accounts.list', paged: { size: 25 } },
      { entity: 'note', paged: true },
      { entity: 'note', params: { q: { search: 'q' } } },
    ]) {
      expect(anchorDefSchema.safeParse(list(source)).success, JSON.stringify(source)).toBe(false)
    }
  })
})
