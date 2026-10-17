import { describe, expect, it } from 'vitest'

import { tenantDatabase, tenantRegionId } from './tenant'

describe('tenant names', () => {
  it('names the database and the region of a key', () => {
    expect(tenantDatabase('acme')).toBe('t_acme')
    expect(tenantRegionId('acme')).toBe('tenant:acme')
  })
})
