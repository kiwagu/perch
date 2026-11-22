import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { renderReference } from '../reference'

import { REFERENCE_FILE, SCREEN_SCHEMA_FILE } from './paths'
import { SCHEMA_OUTPUTS, schemaDrift, writeSchemas } from './schema-outputs'
import { jsonSchemaProblems, validateAgainst } from './validator'

let root: string

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/**
 * The JSON paths of every property in `schema` that carries no description. The keys of
 * `properties` are names, each over a schema; every other keyword is walked as a schema.
 */
function undescribed(schema: unknown, path = ''): string[] {
  if (Array.isArray(schema)) {
    return schema.flatMap((item, index) => undescribed(item, `${path}[${index}]`))
  }

  if (!isObject(schema)) {
    return []
  }

  return Object.entries(schema).flatMap(([key, value]) => {
    if (key !== 'properties' || !isObject(value)) {
      return undescribed(value, `${path}.${key}`)
    }

    return Object.entries(value).flatMap(([name, property]) => [
      ...(isObject(property) && 'description' in property ? [] : [`${path}.properties.${name}`]),
      ...undescribed(property, `${path}.properties.${name}`),
    ])
  })
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-schemas-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('writeSchemas', () => {
  it('writes the schemas, then the reference', () => {
    expect(writeSchemas(root)).toEqual([
      'contract/schemas/screen.schema.json',
      'contract/schemas/platform.schema.json',
      'contract/schemas/activity.schema.json',
      'contract/schemas/x-perch.schema.json',
      'contract/schemas/manifest.schema.json',
      'contract/REFERENCE.md',
    ])
    expect(readFileSync(join(root, REFERENCE_FILE), 'utf8')).toBe(renderReference())
  })
  it.each(SCHEMA_OUTPUTS.map((output) => output.file))(
    'writes %s as a JSON Schema 2020-12 with a description on every property',
    (file) => {
      writeSchemas(root)

      const schema = JSON.parse(readFileSync(join(root, file), 'utf8')) as unknown

      expect(jsonSchemaProblems(file, schema)).toEqual([])
      expect(schema).toMatchObject({ $schema: 'https://json-schema.org/draft/2020-12/schema' })
      expect(undescribed(schema)).toEqual([])
    },
  )
})

describe('schemaDrift', () => {
  it('is empty right after writing', () => {
    writeSchemas(root)

    expect(schemaDrift(root)).toEqual([])
  })
  it('names a file whose content changed by one byte', () => {
    writeSchemas(root)

    const file = join(root, 'contract/schemas/x-perch.schema.json')
    const text = readFileSync(file, 'utf8')
    const at = text.indexOf('object')

    writeFileSync(file, `${text.slice(0, at)}O${text.slice(at + 1)}`)

    expect(schemaDrift(root)).toEqual([
      {
        file: 'contract/schemas/x-perch.schema.json',
        message: 'differs from its Zod source; run `bun run contract:schemas`',
      },
    ])
  })
  it('names a missing file', () => {
    expect(schemaDrift(root).map((problem) => problem.file)).toEqual([
      'contract/schemas/screen.schema.json',
      'contract/schemas/platform.schema.json',
      'contract/schemas/activity.schema.json',
      'contract/schemas/x-perch.schema.json',
      'contract/schemas/manifest.schema.json',
    ])
  })
})

describe('the screen schema an editor reads', () => {
  const schema = SCHEMA_OUTPUTS.find(({ file }) => file === SCREEN_SCHEMA_FILE)?.schema() ?? {}

  /** A screen whose parallel state has the region `form` written as `form`. */
  const screenWith = (form: unknown) => ({
    id: 'sample',
    title: 'Sample',
    description: 'A sample screen.',
    flag: null,
    bindings: [{ path: '/sample', roles: ['member'] }],
    entry: ['sample.page'],
    anchors: { 'sample.page': { kind: 'page' } },
    flow: {
      initial: 'viewing',
      states: {
        viewing: {
          type: 'parallel',
          states: { form, other: { initial: 'idle', states: { idle: {} } } },
        },
      },
    },
  })
  const removal = (extra: Record<string, unknown>) => ({
    by: 'sample.page.remove-button',
    onError: { actions: [{ show: 'sample.page.error' }] },
    ...extra,
  })

  it('takes a region by its button and an effect by its name', () => {
    expect(validateAgainst('x.yaml', schema, screenWith(removal({})))).toEqual([])
  })

  it('takes a parallel state that writes fewer than two regions, the loader deriving the rest', () => {
    const parallel = (states: Record<string, unknown>) => ({
      ...screenWith(removal({})),
      flow: { initial: 'viewing', states: { viewing: { type: 'parallel', states } } },
    })

    expect(validateAgainst('x.yaml', schema, parallel({ list: removal({}) }))).toEqual([])
    expect(validateAgainst('x.yaml', schema, parallel({}))).toEqual([])
  })

  it('refuses a region by its button that names what the binding gives, as the loader does', () => {
    expect(
      validateAgainst('x.yaml', schema, screenWith(removal({ src: 'thing.remove' }))),
    ).not.toEqual([])
  })
})

describe('the generated schemas and an invariant named twice in a list', () => {
  /** Every schema of a property named `invariant` in a generated schema, at any depth. */
  function invariantProperties(node: unknown): unknown[] {
    if (Array.isArray(node)) {
      return node.flatMap(invariantProperties)
    }
    if (typeof node !== 'object' || node === null) {
      return []
    }
    const record = node as Record<string, unknown>
    const properties = record['properties']
    const own =
      typeof properties === 'object' && properties !== null && 'invariant' in properties
        ? [(properties as Record<string, unknown>)['invariant']]
        : []

    return [...own, ...Object.values(record).flatMap(invariantProperties)]
  }

  it('makes the list of names unique in the platform and the manifest schemas', () => {
    for (const output of SCHEMA_OUTPUTS.filter(({ file }) => /platform|manifest/.test(file))) {
      const lists = invariantProperties(output.schema()).flatMap((property) => {
        const branches = (property as { anyOf?: unknown[] }).anyOf ?? []

        return branches.filter(
          (branch) => (branch as { type?: string }).type === 'array',
        ) as Array<{ minItems?: number; uniqueItems?: boolean }>
      })

      expect(lists.length, output.file).toBeGreaterThan(0)
      for (const list of lists) {
        expect(list, output.file).toMatchObject({ minItems: 2, uniqueItems: true })
      }
    }
  })
  it('refuses a platform file whose code names an invariant twice, by its generated schema', () => {
    const output = SCHEMA_OUTPUTS.find(({ file }) => /platform/.test(file))

    if (output === undefined) {
      throw new Error('no platform schema output')
    }

    const platformFile = (invariant: unknown) => ({
      version: 6,
      actions: {
        'sign-in': {
          description: 'Signs this device in.',
          params: {},
          result: 'the device is signed in',
          codes: { 'rate-limited': { invariant } },
          changes: [],
        },
      },
      reserved: [],
      status: { anchor: 'app-shell.status', states: ['ready'] },
    })
    const problems = (invariant: unknown) =>
      validateAgainst('platform.yaml', output.schema(), platformFile(invariant)).map(
        ({ message }) => message,
      )

    expect(problems(['failed-sign-ins', 'address-mails'])).toEqual([])
    expect(problems(['failed-sign-ins', 'failed-sign-ins']).join(' ')).toMatch(/duplicate/)
  })
})
