import { ESLint } from 'eslint'
import { describe, expect, it } from 'vitest'

import { base, ignores } from './index.js'

const cwd = new URL('./__fixtures__/project/', import.meta.url).pathname
const eslint = new ESLint({
  cwd,
  overrideConfigFile: true,
  overrideConfig: base.filter((entry) => entry !== ignores),
})

async function rulesFiredIn(file) {
  const [result] = await eslint.lintFiles([file])

  return [...new Set(result.messages.map((message) => message.ruleId ?? message.message))]
}

describe('workspace eslint config', () => {
  it('accepts code that follows the conventions', async () => {
    expect(await rulesFiredIn('clean.ts')).toEqual([])
    expect(await rulesFiredIn('feature/domain/invariant.ts')).toEqual([])
  })

  it('requires a blank line after local variables and before return', async () => {
    expect(await rulesFiredIn('padding.ts')).toEqual(['@stylistic/padding-line-between-statements'])
  })

  it('reports a floating promise', async () => {
    expect(await rulesFiredIn('promise.ts')).toEqual(['@typescript-eslint/no-floating-promises'])
  })

  it('keeps domain code from importing outer layers and drivers', async () => {
    expect(await rulesFiredIn('feature/domain/layer-leak.ts')).toEqual(['boundaries/dependencies'])
    expect(await rulesFiredIn('feature/domain/driver-leak.ts')).toEqual(['no-restricted-imports'])
  })

  it('forbids let and throwing plain errors in domain code', async () => {
    expect(await rulesFiredIn('feature/domain/mutable.ts')).toEqual(['functional/no-let'])
    expect(await rulesFiredIn('feature/domain/throws.ts')).toEqual(['no-restricted-syntax'])
  })
})
