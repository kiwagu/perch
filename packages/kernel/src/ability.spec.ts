import { describe, expect, it } from 'vitest'

import {
  type AbilitySchema,
  defineAbilityFor,
  NO_ABILITY,
  OWNER_ABILITY,
  ownerKeyOf,
  TENANT_ROLES,
} from './ability'

const schema: AbilitySchema = {
  note: {
    owner: 'author',
    can: {
      member: { create: 'any', update: 'own', delete: 'own' },
      admin: { create: 'any', update: 'any', delete: 'any' },
    },
  },
  memo: { can: { admin: { create: 'any' } } },
}
const ann = defineAbilityFor({ id: 'idn_ann', role: 'member' }, schema)
const boss = defineAbilityFor({ id: 'idn_boss', role: 'admin' }, schema)
const annsNote = { author: 'member:idn_ann', text: 'hi' }
const bobsNote = { author: 'member:idn_bob', text: 'yo' }

describe('defineAbilityFor', () => {
  it('lets a member create, and edit or delete only the records it owns', () => {
    expect(ann.can('create', 'note')).toBe(true)
    expect(ann.can('update', 'note', annsNote)).toBe(true)
    expect(ann.can('delete', 'note', annsNote)).toBe(true)
    expect(ann.can('update', 'note', bobsNote)).toBe(false)
    expect(ann.can('delete', 'note', bobsNote)).toBe(false)
  })

  it('lets an admin edit and delete any record of the table', () => {
    expect(boss.can('update', 'note', bobsNote)).toBe(true)
    expect(boss.can('delete', 'note', annsNote)).toBe(true)
  })

  it('reads the owner by key, from a document reference or a projected row', () => {
    expect(ann.can('update', 'note', { author: 'idn_ann' })).toBe(true)
    expect(ann.can('update', 'note', { author: 'member:idn_ann' })).toBe(true)
    expect(ann.can('update', 'note', {})).toBe(false)
    expect(ann.can('update', 'note')).toBe(false)
  })

  it('allows nothing on a table without rules for the role, or unknown to the schema', () => {
    expect(ann.can('create', 'memo')).toBe(false)
    expect(boss.can('create', 'memo')).toBe(true)
    expect(boss.can('update', 'memo', {})).toBe(false)
    expect(boss.can('create', 'course')).toBe(false)
  })

  it('has an owner ability that allows everything and a no ability that allows nothing', () => {
    expect(OWNER_ABILITY.can('delete', 'anything')).toBe(true)
    expect(NO_ABILITY.can('create', 'note')).toBe(false)
  })

  it('names the two roles and takes the key of an owner reference', () => {
    expect(TENANT_ROLES).toEqual(['member', 'admin'])
    expect(ownerKeyOf('member:idn_a')).toBe('idn_a')
    expect(ownerKeyOf('idn_a')).toBe('idn_a')
    expect(ownerKeyOf('')).toBeUndefined()
    expect(ownerKeyOf(3)).toBeUndefined()
  })
})
