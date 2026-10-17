import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { readSchema } from './schema-files'

const file = (path: string): string =>
  readFileSync(new URL(`../../../database/schema/${path}`, import.meta.url), 'utf8')

describe('readSchema', () => {
  it('composes the directory database from the common files and its own', () => {
    const text = readSchema('directory')

    expect(text.startsWith(file('common/entity-id.surql'))).toBe(true)
    expect(text).toContain(file('directory/identity.surql'))
    expect(text).toContain(file('directory/tenant.surql'))
    expect(text).toContain(file('common/replica.surql'))
    expect(text).not.toContain(file('tenant/note.surql'))
  })

  it('composes the tenant database from the common files and its own', () => {
    const text = readSchema('tenant')

    expect(text.startsWith(file('common/entity-id.surql'))).toBe(true)
    expect(text).toContain(file('tenant/note.surql'))
    expect(text).toContain(file('tenant/member.surql'))
    expect(text).not.toContain(file('directory/identity.surql'))
  })
})
