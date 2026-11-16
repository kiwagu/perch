import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'
import { parse } from 'yaml'

import { checkContract, loadContract } from '../../check'
import { buildManifest } from '../../manifest'
import { failuresOf } from '../derive'
import { loadModel } from '../model'
import { PLATFORM_FILE } from '../paths'
import { formatProblem } from '../problems'
import { loadResolvedModel } from '../screens'

import { type DefaultsRepository, writeDefaultsRepository } from './defaults.fixture'
import { fieldValueOf } from './field-value'
import { parameterValueOf, resolveValue } from './resolve'

const roots: string[] = []

function repository(options: DefaultsRepository): string {
  const root = mkdtempSync(join(tmpdir(), 'ui-contract-defaults-'))

  roots.push(root)
  writeDefaultsRepository(root, options)

  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

/** The contract `root` loads, or a failure naming its problems. */
function loaded(root: string) {
  const { contract, problems } = loadContract(root)

  if (contract === undefined) {
    throw new Error(problems.map(formatProblem).join('\n'))
  }

  return contract
}

const messages = (root: string): string[] => loadContract(root).problems.map(formatProblem)

const SIX = { version: 6, defaults: 80, withNull: true } as const

describe('the default length of a contract at version 6', () => {
  it('passes the check with a default, a value and a field that name no limit, and a null limit', () => {
    expect(checkContract(repository(SIX)).map(formatProblem)).toEqual([])
  })

  it('is the limit of a value that names none, as every reader takes it', () => {
    const { screens, model } = loaded(repository(SIX))
    const screen = screens.screens.find(({ id }) => id === 'sample')

    expect(resolveValue('name', screens.platform, model)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
    expect(parameterValueOf('platform.sign-out', 'reason', screens.platform, model)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
    expect(resolveValue('thing.title', screens.platform, model)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
    expect(
      screen === undefined
        ? undefined
        : fieldValueOf('sample.title-input', screen, screens.platform, model),
    ).toEqual({ type: 'string', minLength: 1, maxLength: 80 })
  })

  it('leaves a null limit out and keeps a written one', () => {
    const { screens, model } = loaded(repository(SIX))

    expect(resolveValue('password', screens.platform, model)).toEqual({
      type: 'string',
      minLength: 1,
    })
    expect(resolveValue('email', screens.platform, model)).toEqual({
      type: 'string',
      maxLength: 254,
      format: 'email',
    })
  })

  it('gives a field of the model that names no limit its too-long code', () => {
    const root = repository(SIX)
    const { screens, model } = loaded(root)
    const written = loadModel(root).model

    expect(written?.entities['thing']?.fields['title']).not.toHaveProperty('maxLength')
    expect(failuresOf(written, screens.platform.actions, 6)('thing.updateThing')).toEqual({
      codes: ['forbidden', 'title-required', 'title-taken', 'failed'],
      params: { title: ['title-required', 'title-taken'] },
    })
    expect(failuresOf(model, screens.platform.actions, 6)('thing.updateThing')).toEqual({
      codes: ['forbidden', 'title-required', 'title-too-long', 'title-taken', 'failed'],
      params: { title: ['title-required', 'title-too-long', 'title-taken'] },
    })
  })

  it('reaches a reader of the model alone (`loadResolvedModel`), the model file left as written', () => {
    const root = repository(SIX)

    expect(loadResolvedModel(root).model?.entities['thing']?.fields['title']).toEqual(
      loaded(root).model.entities['thing']?.fields['title'],
    )
    expect(loadResolvedModel(root).model?.entities['thing']?.fields['title']?.maxLength).toBe(80)
    expect(loadModel(root).model?.entities['thing']?.fields['title']?.maxLength).toBeUndefined()
  })

  it('is in the manifest: the default, the values and the model document with it taken', () => {
    const manifest = buildManifest({
      ...loaded(repository(SIX)),
      product: { name: 'sample', version: '0.1.0', commit: null },
    })
    const title = (manifest.model['$defs'] as { thing: { properties: { title: unknown } } }).thing
      .properties.title

    expect(manifest.contract.defaults).toEqual({ maxLength: 80 })
    expect(manifest.platform.values?.['name']?.maxLength).toBe(80)
    expect(manifest.platform.values?.['password']).not.toHaveProperty('maxLength')
    expect(title).toHaveProperty('maxLength', 80)
    expect(manifest.ids['sample.title-input']?.value?.maxLength).toBe(80)
  })

  it('refuses a written limit equal to the default, on a value and on a field of the model', () => {
    const leave =
      '80 is the default length (`defaults.maxLength`), which the value takes: leave it out'

    expect(messages(repository({ ...SIX, name: 80, title: 80 }))).toEqual([
      `contract/domain/model.schema.json:1: $defs.thing.properties.title.maxLength: ${leave}`,
      `${PLATFORM_FILE}:1: values.name.maxLength: ${leave}`,
    ])
    expect(messages(repository({ ...SIX, name: 81, title: 79 }))).toEqual([])
  })

  it('refuses a null limit while the platform declares no default', () => {
    expect(messages(repository({ version: 6, withNull: true }))).toEqual([
      `${PLATFORM_FILE}:1: values.password.maxLength: null says the value takes no default length, but the platform declares none (\`defaults.maxLength\`): leave it out`,
    ])
  })

  it('refuses a parameter that widens the defaulted limit of its value', () => {
    const root = repository({
      ...SIX,
      reason: '{ value: name, maxLength: 100, optional: true, description: Why. }',
    })

    expect(checkContract(root).map(formatProblem)).toEqual([
      `${PLATFORM_FILE}:1: actions["sign-out"].params.reason.maxLength: 100 does not narrow the value "name", whose maxLength is 80: a keyword written beside \`value\` may only narrow it`,
    ])
  })
})

describe('the default length of an inline parameter of a contract at version 6', () => {
  const INLINE = '{ type: string, minLength: 1, optional: true, description: Why. }'
  const reasonOf = (root: string, action = 'platform.sign-out') => {
    const { screens, model } = loaded(root)

    return parameterValueOf(action, 'reason', screens.platform, model)
  }

  it('is the limit of a parameter that constrains its string and names none, by the default', () => {
    expect(reasonOf(repository({ ...SIX, reason: INLINE }))).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
    expect(reasonOf(repository({ ...SIX, defaults: 81, reason: INLINE }))).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 81,
    })
  })

  it('keeps the limit the parameter writes, whatever the default', () => {
    const own = '{ type: string, minLength: 1, maxLength: 20, optional: true, description: Why. }'

    expect(reasonOf(repository({ ...SIX, reason: own })).maxLength).toBe(20)
    expect(reasonOf(repository({ ...SIX, defaults: 81, reason: own })).maxLength).toBe(20)
  })

  it('leaves the file as written and the check passing, the loaded platform taking the default', () => {
    const root = repository({ ...SIX, reason: INLINE })
    const { screens } = loaded(root)
    const written = parse(readFileSync(join(root, PLATFORM_FILE), 'utf8')) as {
      actions: Record<string, { params: Record<string, unknown> }>
    }

    expect(checkContract(root).map(formatProblem)).toEqual([])
    expect(written.actions['sign-out']?.params['reason']).not.toHaveProperty('maxLength')
    expect(screens.platform.actions['sign-out']?.params['reason']).toHaveProperty('maxLength', 80)
  })

  it('is in the manifest with the default taken, as the platform values are', () => {
    const manifest = buildManifest({
      ...loaded(repository({ ...SIX, reason: INLINE })),
      product: { name: 'sample', version: '0.1.0', commit: null },
    })

    expect(manifest.platform.actions['sign-out']?.params['reason']?.maxLength).toBe(80)
  })

  it('does not let the default stand for the constraint a string that writes none lacks', () => {
    const bare = '{ type: string, optional: true, description: Why. }'

    expect(messages(repository({ ...SIX, reason: bare }))).toEqual([])
    expect(checkContract(repository({ ...SIX, reason: bare })).map(formatProblem)).toEqual([
      `${PLATFORM_FILE}:1: actions["sign-out"].params.reason: a string that refers to no value and writes no constraint: refer to a value (\`value: <name>\`) or write a constraint beside its type`,
    ])
    expect(reasonOf(repository({ ...SIX, reason: bare }))).toEqual({ type: 'string' })
  })

  it('holds a too-long code of a parameter that takes the default to a limit it has, as at version 5 it has none', () => {
    const lacksLimit = (version: number) =>
      checkContract(
        repository({ version, defaults: 80, reason: INLINE, codes: ['reason-too-long'] }),
      )
        .map(formatProblem)
        .filter((message) => message.endsWith('whose value has no maxLength'))

    expect(lacksLimit(6)).toEqual([])
    expect(lacksLimit(5)).toHaveLength(1)
  })
})

describe('the default length of a contract at version 5', () => {
  const FIVE = { version: 5, title: undefined } as const

  /** The platform's values as `platform.yaml` writes them. */
  const writtenValues = (root: string): unknown =>
    (parse(readFileSync(join(root, PLATFORM_FILE), 'utf8')) as { values: unknown }).values

  it('loads the values and the model exactly as written, with no default and none written', () => {
    const root = repository(FIVE)
    const contract = loaded(root)

    expect(contract.screens.platform.values).toStrictEqual(writtenValues(root))
    expect(contract.model).toStrictEqual(loadModel(root).model)
    expect(JSON.stringify(contract.screens.platform)).not.toContain('"defaults"')
  })

  it('takes no default it writes and refuses nothing a later version refuses', () => {
    const root = repository({ ...FIVE, defaults: 80, name: 80, title: 80, withNull: true })
    const contract = loaded(root)

    expect(contract.model).toStrictEqual(loadModel(root).model)
    expect(contract.screens.platform.values?.['name']).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
      description: 'A name.',
    })
    expect(contract.screens.platform.values?.['password']).not.toHaveProperty('maxLength')
    expect(resolveValue('thing.title', contract.screens.platform, contract.model)).toEqual({
      type: 'string',
      minLength: 1,
      maxLength: 80,
    })
  })

  it('gives a field that names no limit no too-long code, and the manifest no default', () => {
    const contract = loaded(repository({ ...FIVE, defaults: 80 }))
    const manifest = buildManifest({
      ...contract,
      product: { name: 'sample', version: '0.1.0', commit: null },
    })

    expect(
      failuresOf(contract.model, contract.screens.platform.actions, 5)('thing.updateThing'),
    ).toEqual({
      codes: ['forbidden', 'title-required', 'title-taken', 'failed'],
      params: { title: ['title-required', 'title-taken'] },
    })
    expect(manifest.contract).not.toHaveProperty('defaults')
    expect(manifest.ids['sample.title-input']?.value).not.toHaveProperty('maxLength')
  })

  it('takes no default for an inline parameter either, as written', () => {
    const root = repository({
      ...FIVE,
      defaults: 80,
      reason: '{ type: string, minLength: 1, optional: true, description: Why. }',
    })
    const { screens, model } = loaded(root)

    expect(parameterValueOf('platform.sign-out', 'reason', screens.platform, model)).toEqual({
      type: 'string',
      minLength: 1,
    })
  })

  it('lets a parameter write a limit beside a value that names none', () => {
    const root = repository({
      ...FIVE,
      reason: '{ value: name, maxLength: 100, optional: true, description: Why. }',
    })

    expect(checkContract(root).map(formatProblem)).toEqual([])
  })
})
