import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { REPOSITORY_ROOT } from './manifest.fixture'
import { productInfo } from './product'

describe('productInfo', () => {
  it("names the product with the root package's version and the commit checked out", () => {
    const { version } = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8')) as {
      version: string
    }

    const product = productInfo(REPOSITORY_ROOT)

    expect(product.name).toBe('perch')
    expect(product.version).toBe(version)
    expect(product.commit).toMatch(/^[0-9a-f]{40}$/)
  })
})
