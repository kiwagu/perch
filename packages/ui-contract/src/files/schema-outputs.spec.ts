import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { SCREEN_SCHEMA_FILE } from './paths'
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
  it('writes the schemas', () => {
    expect(writeSchemas(root)).toEqual([
      'contract/screen.schema.json',
      'contract/platform.schema.json',
      'contract/activity.schema.json',
      'contract/x-perch.schema.json',
      'contract/manifest.schema.json',
    ])
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

    const file = join(root, 'contract/x-perch.schema.json')
    const text = readFileSync(file, 'utf8')
    const at = text.indexOf('object')

    writeFileSync(file, `${text.slice(0, at)}O${text.slice(at + 1)}`)

    expect(schemaDrift(root)).toEqual([
      {
        file: 'contract/x-perch.schema.json',
        message: 'differs from its Zod source; run `bun run contract:schemas`',
      },
    ])
  })
  it('names a missing file', () => {
    expect(schemaDrift(root).map((problem) => problem.file)).toEqual([
      'contract/screen.schema.json',
      'contract/platform.schema.json',
      'contract/activity.schema.json',
      'contract/x-perch.schema.json',
      'contract/manifest.schema.json',
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
  const submit = (as: string) => ({
    pattern: 'submit',
    by: 'sample.page.save-button',
    as,
    src: 'thing.save',
    onError: { actions: [{ show: { 'sample.page.error': ['failed'] } }] },
  })

  it('takes a region by its pattern and an effect by its name', () => {
    expect(validateAgainst('x.yaml', schema, screenWith(submit('saving')))).toEqual([])
  })

  it('refuses a submit whose action runs in idle, as the loader does', () => {
    expect(validateAgainst('x.yaml', schema, screenWith(submit('idle')))).not.toEqual([])
  })
})
