import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { PAGING_PARTS } from '../anchors'
import { type Contract, loadContract } from '../check'
import { sampleContract, screenIn } from '../check/contract.fixture'
import { formatProblem } from '../files'

import { type EmitRepository, moduleData, writeEmitRepository } from './emit.fixture'
import { fieldFactsModuleOf } from './fields'

const roots: string[] = []

/** The contract of the sample at `options`, loaded as every reader takes it. */
function loaded(options: EmitRepository): { root: string; contract: Contract } {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-emit-fields-'))

  roots.push(root)
  writeEmitRepository(root, options)

  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(problems.map(formatProblem).join('\n'))
  }

  return { root, contract }
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

type Facts = Record<string, Record<string, unknown>>

const factsOf = (contract: Pick<Contract, 'screens' | 'model'>): Facts =>
  moduleData(fieldFactsModuleOf(contract)) as Facts

/** What the sample's screen file writes of `anchor`, as written. */
const written = (root: string, anchor: string): Record<string, unknown> | undefined =>
  (
    parse(readFileSync(join(root, 'contract/domain/screens/sample/$key.yaml'), 'utf8')) as {
      anchors: Record<string, Record<string, unknown>>
    }
  ).anchors[anchor]

const SIX = { version: 6, defaults: 80 } as const

describe('fieldFactsModuleOf', () => {
  it('gives each declared field that carries a fact its facts, by anchor, and nothing else', () => {
    expect(factsOf(loaded(SIX).contract)).toEqual({
      'sample.code-input': { maxLength: 254 },
      'sample.email-input': { type: 'email' },
      'sample.forget-checkbox': { holdsInput: false },
      'sample.reason-input': { maxLength: 254, type: 'email', marksState: false },
      'sample.title-input': { maxLength: 80 },
    })
  })

  it('gives a text field the limit of its value, the default length where the value names none', () => {
    const { root, contract } = loaded(SIX)

    expect(written(root, 'sample.title-input')).not.toHaveProperty('maxLength')
    expect(factsOf(contract)['sample.title-input']).toEqual({ maxLength: 80 })
    expect(factsOf(loaded({ version: 5 }).contract)).not.toHaveProperty('sample.title-input')
  })

  it('gives a field an inline parameter passes the default length, and follows a change of it', () => {
    const inline = '{ type: string, minLength: 1, optional: true, description: A code. }'
    const own =
      '{ type: string, minLength: 1, maxLength: 20, optional: true, description: A code. }'
    const codeOf = (options: EmitRepository) =>
      factsOf(loaded(options).contract)['sample.code-input']
    const { root } = loaded({ ...SIX, code: inline })

    const platform = parse(readFileSync(join(root, 'contract/domain/platform.yaml'), 'utf8')) as {
      actions: Record<string, { params: Record<string, unknown> }>
    }

    expect(platform.actions['sign-out']?.params['code']).not.toHaveProperty('maxLength')
    expect(codeOf({ ...SIX, code: inline })).toEqual({ maxLength: 80 })
    expect(codeOf({ version: 6, defaults: 81, code: inline })).toEqual({ maxLength: 81 })
    expect(codeOf({ ...SIX, code: own })).toEqual({ maxLength: 20 })
    expect(codeOf({ version: 6, defaults: 81, code: own })).toEqual({ maxLength: 20 })
    expect(codeOf({ version: 5, code: inline })).toBeUndefined()
  })

  it('types an email input email, a read-only one without a limit, and never a secret one', () => {
    const facts = factsOf(loaded(SIX).contract)

    expect(facts['sample.email-input']).toEqual({ type: 'email' })
    expect(facts['sample.reason-input']).toHaveProperty('type', 'email')
    expect(facts['sample.code-input']).toEqual({ maxLength: 254 })
  })

  it('says marksState only where the field writes it', () => {
    const { root, contract } = loaded(SIX)
    const marked = Object.entries(factsOf(contract)).filter(([, facts]) => 'marksState' in facts)

    expect(marked).toEqual([
      ['sample.reason-input', expect.objectContaining({ marksState: false })],
    ])
    expect(written(root, 'sample.reason-input')).toHaveProperty('marksState', false)
  })

  it('says holdsInput: false on a field the loader finds holds no input, and on no other', () => {
    const { root, contract } = loaded(SIX)
    const facts = factsOf(contract)
    const opted = Object.entries(facts).filter(([, each]) => 'holdsInput' in each)

    expect(written(root, 'sample.forget-checkbox')).not.toHaveProperty('holdsInput')
    expect(opted).toEqual([['sample.forget-checkbox', { holdsInput: false }]])
  })

  it("says holdsInput: false on a paged list's size select, which no screen file declares", () => {
    const contract = sampleContract()
    const screen = screenIn(contract, 'sample')

    expect(factsOf(contract)).toEqual({})

    screen.anchors['sample.accounts-list'] = {
      kind: 'list',
      source: { platform: 'accounts.list', paged: true },
      derived: [...PAGING_PARTS],
    }

    expect(factsOf(contract)).toEqual({ 'sample.accounts-list.size-select': { holdsInput: false } })
  })

  it('writes plain data under a GENERATED header, its keys sorted, the same text every time', () => {
    const { root, contract } = loaded(SIX)
    const text = fieldFactsModuleOf(contract)
    const again = loadContract(root).contract ?? expect.unreachable('the contract loads again')

    expect(text.split('\n')[0]).toMatch(
      /^\/\/ GENERATED by @workspace\/ui-contract .*Do not edit\.$/,
    )
    expect(text).toContain('\nexport const FIELD_FACTS = {\n')
    expect(text.endsWith('\n} as const\n')).toBe(true)
    expect(text).not.toMatch(/^import /m)
    expect(fieldFactsModuleOf(again)).toBe(text)

    const keys = Object.keys(factsOf(contract))

    expect(keys).toEqual([...keys].sort())
  })
})
