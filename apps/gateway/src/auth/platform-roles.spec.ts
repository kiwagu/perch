import { describe, expect, it } from 'vitest'

import { rolesOf } from './platform-roles'

describe('rolesOf', () => {
  it('reads an operator as the platform role operator', () => {
    expect(rolesOf('operator')).toEqual(['operator'])
  })

  it.each<{ readonly role: string | null | undefined; readonly what: string }>([
    { role: 'user', what: "the plugin's default role" },
    { role: null, what: 'a role Better Auth reads as null' },
    { role: undefined, what: 'an account written before the role existed' },
    { role: '', what: 'an empty role' },
    { role: 'admin', what: "the plugin's own admin role, which the directory refuses" },
    { role: 'Operator', what: 'another case of operator' },
  ])('reads $role as no platform role: $what', ({ role }) => {
    expect(rolesOf(role)).toEqual([])
  })
})
