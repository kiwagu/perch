import { cpSync, existsSync, mkdirSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { describe, expect, it, vi } from 'vitest'

import { runModel } from './run-model'

// Two values of the contract whose names map to one database parameter.
vi.mock('@workspace/kernel', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  CONTRACT_VALUES: { 'profile.name': { maxLength: 80 }, 'profile-name': { maxLength: 60 } },
}))

const schemaSource = new URL('../../../database/schema/', import.meta.url).pathname

describe('runModel with contract values that name one database parameter twice', () => {
  it('refuses them by name and writes nothing, --check or not', async () => {
    const base = mkdtempSync(join(tmpdir(), 'model-values-'))
    const options = {
      root: join(base, 'apps/web/src'),
      schemaDir: join(base, 'database/schema'),
      suitesDir: join(base, 'database/tests/suites'),
    }

    cpSync(schemaSource, options.schemaDir, { recursive: true })
    mkdirSync(options.suitesDir, { recursive: true })
    mkdirSync(options.root, { recursive: true })

    for (const check of [false, true]) {
      const result = await runModel({ ...options, check })

      expect(result.problems).toEqual([
        'the values profile-name and profile.name name the same database parameter $profile_name_max_length',
      ])
      expect(result.written).toEqual([])
    }

    expect(existsSync(join(base, 'database/src/replica.schema.gen.ts'))).toBe(false)
  })
})
