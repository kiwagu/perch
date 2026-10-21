import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { readSchema } from './schema-files'

const file = (path: string): string =>
  readFileSync(new URL(`../../../database/schema/${path}`, import.meta.url), 'utf8')

/** The files every database shares, in name order: a new one is added here on purpose. */
const COMMON = ['common/entity-id.surql', 'common/replica.surql']

describe('readSchema', () => {
  it('composes the directory database: every common file, then its own, each in name order', () => {
    expect(readSchema('directory')).toBe(
      [
        ...COMMON,
        'directory/device_session.surql',
        'directory/identity.surql',
        'directory/membership.surql',
        'directory/profile.surql',
        'directory/tenant.surql',
      ]
        .map(file)
        .join('\n'),
    )
  })

  it('composes the tenant database: every common file, then its own, each in name order', () => {
    expect(readSchema('tenant')).toBe(
      [...COMMON, 'tenant/member.surql', 'tenant/note.surql'].map(file).join('\n'),
    )
  })
})
