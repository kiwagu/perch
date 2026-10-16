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
    expect(await rulesFiredIn('barrel.ts')).toEqual([])
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

  it('keeps user-visible text in presentation code behind literal t() keys', async () => {
    expect(await rulesFiredIn('feature/presentation/clean.view.tsx')).toEqual([])
    expect(await rulesFiredIn('feature/presentation/raw-text.view.tsx')).toEqual([
      'react/jsx-no-literals',
    ])
    expect(await rulesFiredIn('feature/presentation/dynamic-key.view.tsx')).toEqual([
      'no-restricted-syntax',
    ])
  })

  it('lets application code use data-layer port types but not its adapters', async () => {
    expect(await rulesFiredIn('feature/application/port-types.ts')).toEqual([])
    expect(await rulesFiredIn('feature/application/adapter-leak.ts')).toEqual([
      '@typescript-eslint/no-restricted-imports',
    ])
  })

  it('lets tests of presentation code render literal content', async () => {
    expect(await rulesFiredIn('feature/presentation/greeting.view.spec.tsx')).toEqual([])
  })

  it('forbids let and throwing plain errors in domain code', async () => {
    expect(await rulesFiredIn('feature/domain/mutable.ts')).toEqual(['functional/no-let'])
    expect(await rulesFiredIn('feature/domain/throws.ts')).toEqual(['no-restricted-syntax'])
  })
})
