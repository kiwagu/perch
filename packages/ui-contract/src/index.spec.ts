import { describe, expect, it } from 'vitest'

import * as entry from '.'

describe("the package's entry", () => {
  it('serves the terms: their loader, file and schema, their module and the route keys', () => {
    expect(entry.TERMS_FILE).toBe('contract/domain/terms.yaml')
    expect(typeof entry.loadTerms).toBe('function')
    expect(typeof entry.termsModuleOf).toBe('function')
    expect(entry.routeKeyOf('console.account', 1, '/console/card')).toBe(
      'console.account@/console/card',
    )
    expect(entry.termsFileSchema.safeParse({ contexts: {}, terms: {}, roles: {} }).success).toBe(
      true,
    )
  })
})
