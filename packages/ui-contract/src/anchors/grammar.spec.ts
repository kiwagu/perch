import { describe, expect, it } from 'vitest'

import { isAnchor, kindOf, screenOf, segmentsOf } from './grammar'

describe('anchor grammar', () => {
  it('accepts 2 to 5 kebab-case segments', () => {
    expect(isAnchor('app-shell.status')).toBe(true)
    expect(isAnchor('user.sign-in.email-input')).toBe(true)
    expect(isAnchor('user.profile.sign-out-dialog.confirm-button')).toBe(true)
    expect(isAnchor('status')).toBe(false)
    expect(isAnchor('User.sign-in.email')).toBe(false)
    expect(isAnchor('user.sign-in.email_input')).toBe(false)
    expect(isAnchor('a.b.c.d.e.f')).toBe(false)
  })
  it('reads the kind from the last segment', () => {
    expect(kindOf('user.sign-in.email-input')).toBe('input')
    expect(kindOf('app-shell.status')).toBe('status')
    expect(kindOf('organisation.notes.item')).toBe('item')
  })
  it('finds the longest screen name on segment boundaries', () => {
    const screens = ['user.sign-in', 'user.profile', 'organisation', 'app-shell']

    expect(screenOf('user.sign-in.email-input', screens)).toBe('user.sign-in')
    expect(screenOf('organisation.notes.item', screens)).toBe('organisation')
    expect(screenOf('organisational.x', screens)).toBeUndefined()
    expect(screenOf('device.list', screens)).toBeUndefined()
    expect(screenOf('app-shell', screens)).toBe('app-shell')
  })
  it('prefers the longer of two nested screen names', () => {
    const screens = ['user', 'user.sign-in']

    expect(screenOf('user.sign-in.email-input', screens)).toBe('user.sign-in')
    expect(screenOf('user.profile.heading', screens)).toBe('user')
  })
  it('splits segments', () => {
    expect(segmentsOf('a.b-c.d')).toEqual(['a', 'b-c', 'd'])
  })
})
