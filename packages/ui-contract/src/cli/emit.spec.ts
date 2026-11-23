import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { type Contract, loadContract } from '../check'
import { fieldFactsModuleOf, termsModuleOf, valuesModuleOf } from '../emit'
import { writeEmitRepository } from '../emit/emit.fixture'
import { formatProblem, MODEL_FILE } from '../files'

import { run } from './run'

/** A folder of the repository below its root, as a package that runs the emit is. */
const PACKAGE = 'packages/sample'

let root: string
let err: string[]
let out: string[]

/** Runs `ui-contract emit` from the folder `at`, capturing its exit code and both streams. */
function emit(
  argv: readonly string[],
  at = join(root, PACKAGE),
): { code: number; out: string; err: string } {
  out = []
  err = []
  vi.spyOn(process, 'cwd').mockReturnValue(at)

  const code = run(['emit', ...argv])

  return { code, out: out.join('\n'), err: err.join('\n') }
}

function contractOf(): Contract {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(problems.map(formatProblem).join('\n'))
  }

  return contract
}

const read = (path: string): string => readFileSync(join(root, path), 'utf8')

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-cli-emit-'))
  writeEmitRepository(root, { version: 6, defaults: 80 })
  mkdirSync(join(root, PACKAGE, 'src'), { recursive: true })
  vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => {
    out.push(parts.join(' '))
  })
  vi.spyOn(console, 'error').mockImplementation((...parts: unknown[]) => {
    err.push(parts.join(' '))
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  rmSync(root, { recursive: true, force: true })
})

describe('ui-contract emit', () => {
  it('writes the values module to --out, relative to the folder it runs from', () => {
    const result = emit(['values', '--out', 'src/contract-values.gen.ts'])

    expect(result).toMatchObject({ code: 0, err: '' })
    expect(result.out).toContain(join(root, PACKAGE, 'src/contract-values.gen.ts'))
    expect(read(`${PACKAGE}/src/contract-values.gen.ts`)).toBe(valuesModuleOf(contractOf()))
  })

  it('writes the field facts module to --out', () => {
    expect(emit(['fields', '--out', 'src/field-facts.gen.ts'])).toMatchObject({ code: 0 })
    expect(read(`${PACKAGE}/src/field-facts.gen.ts`)).toBe(fieldFactsModuleOf(contractOf()))
  })

  it('writes the terms module to --out', () => {
    expect(emit(['terms', '--out', 'src/contract-terms.gen.ts'])).toMatchObject({ code: 0 })
    expect(read(`${PACKAGE}/src/contract-terms.gen.ts`)).toBe(termsModuleOf(contractOf()))
  })

  it('writes nowhere without --out: the caller names the file', () => {
    for (const argv of [['values'], ['values', '--out']]) {
      const result = emit(argv)

      expect(result.code).toBe(1)
      expect(result.err).toContain('--out <file>')
    }

    expect(existsSync(join(root, PACKAGE, 'src', 'contract-values.gen.ts'))).toBe(false)
  })

  it('refuses a module it does not emit', () => {
    const result = emit(['routes', '--out', 'src/routes.gen.ts'])

    expect(result.code).toBe(1)
    expect(result.err).toContain('values')
    expect(existsSync(join(root, PACKAGE, 'src', 'routes.gen.ts'))).toBe(false)
  })

  it('writes nothing for a contract that fails the contract check, and prints its problems', () => {
    rmSync(join(root, MODEL_FILE))

    const result = emit(['values', '--out', 'src/contract-values.gen.ts'])

    expect(result.code).toBe(1)
    expect(result.err).toContain(MODEL_FILE)
    expect(existsSync(join(root, PACKAGE, 'src', 'contract-values.gen.ts'))).toBe(false)
  })

  it('finds no contract outside a repository that holds one', () => {
    const outside = mkdtempSync(join(tmpdir(), 'ui-contract-cli-emit-outside-'))

    try {
      const result = emit(['values', '--out', 'values.gen.ts'], outside)

      expect(result.code).toBe(1)
      expect(existsSync(join(outside, 'values.gen.ts'))).toBe(false)
    } finally {
      rmSync(outside, { recursive: true, force: true })
    }
  })
})
