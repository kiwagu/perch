import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { loadModel } from './model'
import { MODEL_FILE } from './paths'

const FIXTURE = join(import.meta.dirname, '../__fixtures__/model.schema.json')

interface Document {
  $defs: Record<string, Record<string, unknown>>
}

let root: string

/** The fixture with `change` applied to it, written to the temporary root. */
function writeModel(change: (document: Document) => void): void {
  const document = JSON.parse(readFileSync(FIXTURE, 'utf8')) as Document

  change(document)
  writeFileSync(join(root, MODEL_FILE), JSON.stringify(document))
}

const messages = (): string[] => loadModel(root).problems.map((problem) => problem.message)

/** The actions of the fixture's `thing`, as the document holds them, for a spec to change. */
function thingActions(document: Document): Record<string, object> {
  const perch = document.$defs['thing']?.['x-perch'] as
    | { actions?: Record<string, object> }
    | undefined
  const actions = perch?.actions

  if (actions === undefined) {
    throw new Error('the fixture lost the actions of thing')
  }

  return actions
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ui-contract-model-'))
  mkdirSync(join(root, 'contract'))
  cpSync(FIXTURE, join(root, MODEL_FILE))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('loadModel', () => {
  it('loads the fixture with its entity', () => {
    const { model, problems } = loadModel(root)
    const thing = model?.entities['thing']

    expect(problems).toEqual([])
    expect(model?.document['title']).toBe('Sample data model')
    expect(thing).toMatchObject({
      name: 'thing',
      table: 'thing',
      region: 'tenant',
      id: 'thg',
      owner: 'author',
      can: { member: { create: 'any', update: 'own' } },
      unique: [['title']],
      index: [],
    })
    expect(thing?.actions).toEqual({
      createThing: { description: 'Adds a thing.', params: { id: '$id', title: 'title' } },
      updateThing: { params: { id: '$id', title: 'title' } },
    })
    expect(thing?.fields).toEqual({
      id: { type: 'string', readonly: true },
      author: { type: 'string', readonly: true, record: 'member' },
      title: { type: 'string', minLength: 1, maxLength: 80, readonly: false, crdt: 'text' },
      size: { enum: ['small', 'large'], readonly: false, crdt: 'none' },
      created_at: { type: 'string', format: 'date-time', readonly: true },
    })
  })
  it('reports a document that is not a JSON Schema 2020-12', () => {
    writeModel((document) => {
      const thing = document.$defs['thing']

      if (thing) {
        thing['type'] = 'banana'
      }
    })

    expect(loadModel(root).model).toBeUndefined()
    expect(messages()).toContain('/$defs/thing/type: must be equal to one of the allowed values')
  })
  it('reports an entity without x-perch', () => {
    writeModel((document) => {
      delete document.$defs['thing']?.['x-perch']
    })

    expect(messages()).toEqual([
      '$defs.thing["x-perch"]: Invalid input: expected object, received undefined',
    ])
  })
  it('treats a field of string enum values without a type as a string field', () => {
    writeModel((document) => {
      const properties = document.$defs['thing']?.['properties'] as Record<string, unknown>

      properties['size'] = { enum: ['small', 'large'] }
    })

    expect(messages()).toEqual([
      '$defs.thing.properties.size: a string field that is not readonly needs x-perch.crdt ("none" for last-writer-wins)',
    ])
  })
  it('carries the reads an action says it changes, and none where it says none', () => {
    writeModel((document) => {
      const actions = thingActions(document)

      actions['createThing'] = { ...actions['createThing'], changes: ['things.list'] }
      actions['updateThing'] = { ...actions['updateThing'], changes: [] }
    })

    expect(loadModel(root).model?.entities['thing']?.actions).toEqual({
      createThing: {
        description: 'Adds a thing.',
        params: { id: '$id', title: 'title' },
        changes: ['things.list'],
      },
      updateThing: { params: { id: '$id', title: 'title' }, changes: [] },
    })
  })
  it('refuses a read an action changes that no platform action could be named', () => {
    writeModel((document) => {
      const actions = thingActions(document)

      actions['updateThing'] = { ...actions['updateThing'], changes: ['Things.list'] }
    })

    const [problem, ...more] = messages()

    expect(loadModel(root).model).toBeUndefined()
    expect(more).toEqual([])
    expect(problem).toMatch(/^\$defs\.thing\["x-perch"\]\.actions\.updateThing\.changes\[0\]: /)
  })
  it('reports a string field that is not readonly and has no crdt', () => {
    writeModel((document) => {
      const properties = document.$defs['thing']?.['properties'] as Record<string, unknown>

      properties['title'] = { type: 'string' }
    })

    expect(messages()).toEqual([
      '$defs.thing.properties.title: a string field that is not readonly needs x-perch.crdt ("none" for last-writer-wins)',
    ])
  })
})
