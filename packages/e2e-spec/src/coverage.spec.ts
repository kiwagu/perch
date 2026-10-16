import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { checkCoverage } from './coverage'

const spec = (steps: number) =>
  [
    '# A title',
    '',
    'Role: guest',
    'Where: "/"',
    '',
    '## Test data',
    '',
    '## Scenario: Something',
    '',
    '### Steps',
    ...Array.from({ length: steps }, (_, index) => `${index + 1}. Step ${index + 1}`),
    '',
    '### Expected result',
    '- Done',
  ].join('\n')

const test = (steps: number) =>
  Array.from({ length: steps }, (_, index) => `await test.step('${index + 1}. x', fn)`).join('\n')

const roots: string[] = []

function project(files: Readonly<Record<string, string>>) {
  const root = mkdtempSync(join(tmpdir(), 'e2e-spec-'))

  roots.push(root)

  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true })
    writeFileSync(join(root, path), content)
  }

  return { specs: join(root, 'specs'), tests: join(root, 'src') }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

describe('checkCoverage', () => {
  it('passes when every spec has its test with a step per spec step', () => {
    const dirs = project({
      'specs/user/01-a.md': spec(2),
      'src/user/01-a.e2e.spec.ts': test(2),
      'src/support/fixtures.ts': 'export {}',
    })

    expect(checkCoverage(dirs.specs, dirs.tests)).toEqual({
      missingTests: [],
      missingSpecs: [],
      stepMismatch: [],
      invalidSpecs: [],
    })
  })

  it('reports a spec without a test, a test without a spec and a test with too few steps', () => {
    const dirs = project({
      'specs/user/01-a.md': spec(4),
      'specs/user/02-b.md': spec(1),
      'src/user/01-a.e2e.spec.ts': test(3),
      'src/user/03-c.e2e.spec.ts': test(1),
    })

    expect(checkCoverage(dirs.specs, dirs.tests)).toEqual({
      missingTests: ['user/02-b'],
      missingSpecs: ['user/03-c'],
      stepMismatch: [{ spec: 'user/01-a', steps: 4, testSteps: 3 }],
      invalidSpecs: [],
    })
  })

  it('reports a spec it cannot read', () => {
    const dirs = project({
      'specs/user/01-a.md': '# Only a title',
      'src/user/01-a.e2e.spec.ts': test(1),
    })

    expect(checkCoverage(dirs.specs, dirs.tests).invalidSpecs).toEqual(['user/01-a'])
  })
})
