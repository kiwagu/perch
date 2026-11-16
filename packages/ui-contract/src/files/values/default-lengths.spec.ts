import { describe, expect, it } from 'vitest'

import type { Model, ModelField } from '../model'
import { MODEL_FILE, PLATFORM_FILE } from '../paths'
import type { PlatformFile } from '../screens'

import { withDefaultLengths } from './default-lengths'

type Values = NonNullable<PlatformFile['values']>

const VALUES: Values = {
  name: { type: 'string', minLength: 1, description: 'A name.' },
  email: { type: 'string', format: 'email', maxLength: 254, description: 'An email.' },
  password: { type: 'string', minLength: 1, maxLength: null, description: 'A password.' },
  role: { enum: ['member', 'admin'], description: 'A role.' },
  size: { type: 'string', enum: ['small', 'large'], description: 'A size.' },
  count: { type: 'integer', minimum: 1, description: 'A count.' },
}

/** A platform file at `version` with the values `values` and the default length `defaults`, none for `null`. */
const platformAt = (
  version: number,
  values: Values = VALUES,
  defaults: number | null = 80,
): PlatformFile => ({
  version,
  ...(defaults === null ? {} : { defaults: { maxLength: defaults } }),
  values,
  actions: {},
  reserved: ['app-shell.status'],
  status: { anchor: 'app-shell.status', states: ['ready'] },
})

const TITLE: ModelField = { type: 'string', minLength: 1, readonly: false, crdt: 'text' }
const AUTHOR: ModelField = { type: 'string', readonly: true, record: 'member' }
const SIZE: ModelField = { enum: ['small', 'large'], readonly: false, crdt: 'none' }

const FIELDS: Record<string, ModelField> = {
  title: TITLE,
  body: { type: 'string', maxLength: 2000, readonly: false, crdt: 'text' },
  author: AUTHOR,
  size: SIZE,
}

/** A model of one entity whose fields are `fields`, its document writing them as a file does. */
function modelOf(fields: Record<string, ModelField> = FIELDS): Model {
  const properties = Object.fromEntries(
    Object.entries(fields).map(([name, { readonly, crdt, record, ...keywords }]) => [
      name,
      { ...keywords, 'x-perch': { ...(readonly ? { readonly } : {}), crdt, record } },
    ]),
  )

  return {
    document: { title: 'A model', $defs: { thing: { type: 'object', properties } } },
    entities: {
      thing: {
        name: 'thing',
        table: 'thing',
        region: 'tenant',
        id: 'thg',
        actions: { updateThing: { params: { id: '$id', title: 'title' }, changes: [] } },
        unique: [],
        index: [],
        fields,
      },
    },
  }
}

describe('withDefaultLengths at version 6', () => {
  it("gives each string value that names no limit the platform's default length", () => {
    const { values, problems } = withDefaultLengths(platformAt(6), undefined)

    expect(problems).toEqual([])
    expect(VALUES['name']).not.toHaveProperty('maxLength')
    expect(values?.['name']).toStrictEqual({ ...VALUES['name'], maxLength: 80 })
  })

  it('keeps a written limit, and gives none to an enum, a value that is no string or a null limit', () => {
    const { values } = withDefaultLengths(platformAt(6), undefined)

    expect(values?.['email']).toStrictEqual(VALUES['email'])
    expect(values?.['role']).toStrictEqual(VALUES['role'])
    expect(values?.['size']).toStrictEqual(VALUES['size'])
    expect(values?.['count']).toStrictEqual(VALUES['count'])
    expect(values?.['password']).toStrictEqual({
      type: 'string',
      minLength: 1,
      description: 'A password.',
    })
  })

  it('gives a writable string field of the model the default, in its entities and its document', () => {
    const { model, problems } = withDefaultLengths(platformAt(6), modelOf())
    const properties = (document: Model['document'] | undefined): unknown =>
      (document?.['$defs'] as { thing: { properties: unknown } } | undefined)?.thing.properties

    expect(problems).toEqual([])
    expect(model?.entities['thing']?.fields).toStrictEqual({
      ...FIELDS,
      title: { ...TITLE, maxLength: 80 },
    })
    expect(properties(modelOf().document)).not.toHaveProperty('title.maxLength')
    expect(properties(model?.document)).toHaveProperty('title.maxLength', 80)
    expect(properties(model?.document)).toHaveProperty('body.maxLength', 2000)
    expect(properties(model?.document)).not.toHaveProperty('author.maxLength')
    expect(properties(model?.document)).not.toHaveProperty('size.maxLength')
  })

  it('refuses a written limit the default gives back, on a value and on a field', () => {
    const values = { ...VALUES, name: { ...VALUES['name'], maxLength: 80 } } as Values
    const fields = { ...FIELDS, title: { ...TITLE, maxLength: 80 } }
    const leave =
      '80 is the default length (`defaults.maxLength`), which the value takes: leave it out'

    expect(withDefaultLengths(platformAt(6, values), modelOf(fields)).problems).toEqual([
      { file: PLATFORM_FILE, message: `values.name.maxLength: ${leave}` },
      { file: MODEL_FILE, message: `$defs.thing.properties.title.maxLength: ${leave}` },
    ])
  })

  it('keeps an equal limit the default would not give back: a read-only field, an enum', () => {
    const fields = {
      ...FIELDS,
      author: { ...AUTHOR, maxLength: 80 },
      size: { ...SIZE, maxLength: 80 },
    }

    expect(withDefaultLengths(platformAt(6), modelOf(fields)).problems).toEqual([])
  })

  it('refuses a null limit without a default, and on a value that takes none anyway', () => {
    const values = {
      ...VALUES,
      role: { ...VALUES['role'], maxLength: null },
      size: { ...VALUES['size'], maxLength: null },
    } as Values
    const anyway =
      'null says the value takes no default length, but a value that is no string, or has an `enum`, takes none anyway: leave it out'

    expect(withDefaultLengths(platformAt(6, values), undefined).problems).toEqual([
      { file: PLATFORM_FILE, message: `values.role.maxLength: ${anyway}` },
      { file: PLATFORM_FILE, message: `values.size.maxLength: ${anyway}` },
    ])
    expect(withDefaultLengths(platformAt(6, VALUES, null), undefined).problems).toEqual([
      {
        file: PLATFORM_FILE,
        message:
          'values.password.maxLength: null says the value takes no default length, but the platform declares none (`defaults.maxLength`): leave it out',
      },
    ])
  })
})

describe('withDefaultLengths before version 6', () => {
  it('takes no default and refuses nothing at version 5, the values and the model as written', () => {
    const values = { ...VALUES, name: { ...VALUES['name'], maxLength: 80 } } as Values
    const model = modelOf({ ...FIELDS, title: { ...TITLE, maxLength: 80 } })
    const five = withDefaultLengths(platformAt(5, values), model)

    expect(five.problems).toEqual([])
    expect(five.model).toBe(model)
    expect(withDefaultLengths(platformAt(5), modelOf()).values?.['name']).toStrictEqual(
      VALUES['name'],
    )
    expect(withDefaultLengths(platformAt(5), modelOf()).model).toStrictEqual(modelOf())
  })

  it('leaves a null limit out at version 5 too: no limit, as a value that writes none', () => {
    const five = withDefaultLengths(platformAt(5, VALUES, null), undefined)

    expect(five.problems).toEqual([])
    expect(five.values?.['password']).toStrictEqual({
      type: 'string',
      minLength: 1,
      description: 'A password.',
    })
  })

  it('writes every value in the order the file writes its keywords', () => {
    const five = withDefaultLengths(platformAt(5), undefined)

    expect(JSON.stringify(five.values?.['email'])).toBe(JSON.stringify(VALUES['email']))
    expect(Object.keys(five.values ?? {})).toEqual(Object.keys(VALUES))
  })
})
