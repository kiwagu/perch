import { describe, expect, it } from 'vitest'

import { modelDescriptions } from './model'

/** A model whose descriptions sit at every place one may, and whose data holds the word `description`. */
const MODEL = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'Sample data model',
  description: 'The things the sample keeps.',
  $defs: {
    note: {
      type: 'object',
      description: 'A note of the organisation.',
      'x-perch': {
        table: 'note',
        region: 'tenant',
        id: 'not',
        actions: {
          createNote: {
            description: 'Adds a note.',
            params: { id: '$id', description: 'description' },
          },
          updateNote: { params: { id: '$id', description: 'description' } },
        },
        unique: [['description']],
      },
      properties: {
        id: { type: 'string', description: "The note's id.", 'x-perch': { readonly: true } },
        description: {
          type: 'string',
          description: 'What the note says.',
          default: '',
          examples: ['A note.'],
          'x-perch': { crdt: 'text' },
        },
        tags: {
          type: 'array',
          items: { type: 'string', description: 'One tag.' },
          default: [{ description: 'not a schema' }],
        },
        size: { enum: ['small', 'large'], 'x-perch': { crdt: 'none' } },
      },
      required: ['id', 'description'],
      additionalProperties: false,
    },
  },
}

describe('modelDescriptions', () => {
  it("reads the model's own description, each entity's, each action's and each field's, a field's subschemas included", () => {
    expect(modelDescriptions(MODEL)).toEqual([
      { at: ['description'], kind: 'model', place: 'model', text: 'The things the sample keeps.' },
      {
        at: ['$defs', 'note', 'description'],
        kind: 'entity',
        place: 'model entity note',
        text: 'A note of the organisation.',
      },
      {
        at: ['$defs', 'note', 'x-perch', 'actions', 'createNote', 'description'],
        kind: 'modelAction',
        place: 'model action note.createNote',
        text: 'Adds a note.',
      },
      {
        at: ['$defs', 'note', 'properties', 'id', 'description'],
        kind: 'field',
        place: 'model field note.id',
        text: "The note's id.",
      },
      {
        at: ['$defs', 'note', 'properties', 'description', 'description'],
        kind: 'field',
        place: 'model field note.description',
        text: 'What the note says.',
      },
      {
        at: ['$defs', 'note', 'properties', 'tags', 'items', 'description'],
        kind: 'field',
        place: 'model field note.tags items',
        text: 'One tag.',
      },
    ])
  })
  it('reads the subschemas of a field by where JSON Schema puts them, a subfield named like a keyword included', () => {
    const field = {
      type: 'object',
      properties: {
        description: { type: 'string', description: 'A subfield named description.' },
        default: { type: 'string', description: 'A subfield named default.' },
        'x-note': { type: 'string', description: 'A subfield named like an extension.' },
      },
      anyOf: [{ description: 'The first shape.' }, { description: 'The second shape.' }],
      $defs: { enum: { description: 'A definition named enum.' } },
      additionalProperties: { description: 'Any other subfield.' },
      default: { description: 'data, not a schema' },
      examples: [{ description: 'data, not a schema' }],
    }
    const model = { $defs: { note: { type: 'object', properties: { meta: field } } } }
    const at = (...keys: PropertyKey[]) => ['$defs', 'note', 'properties', 'meta', ...keys]

    expect(modelDescriptions(model)).toEqual([
      {
        at: at('properties', 'description', 'description'),
        kind: 'field',
        place: 'model field note.meta properties description',
        text: 'A subfield named description.',
      },
      {
        at: at('properties', 'default', 'description'),
        kind: 'field',
        place: 'model field note.meta properties default',
        text: 'A subfield named default.',
      },
      {
        at: at('properties', 'x-note', 'description'),
        kind: 'field',
        place: 'model field note.meta properties x-note',
        text: 'A subfield named like an extension.',
      },
      {
        at: at('anyOf', 0, 'description'),
        kind: 'field',
        place: 'model field note.meta anyOf 0',
        text: 'The first shape.',
      },
      {
        at: at('anyOf', 1, 'description'),
        kind: 'field',
        place: 'model field note.meta anyOf 1',
        text: 'The second shape.',
      },
      {
        at: at('$defs', 'enum', 'description'),
        kind: 'field',
        place: 'model field note.meta $defs enum',
        text: 'A definition named enum.',
      },
      {
        at: at('additionalProperties', 'description'),
        kind: 'field',
        place: 'model field note.meta additionalProperties',
        text: 'Any other subfield.',
      },
    ])
  })
  it("reads the subschemas of the document and of an entity beside their entities and fields, as the model's and the entity's", () => {
    const model = {
      description: 'The model.',
      allOf: [{ description: 'A shape of the whole model.' }],
      $defs: {
        note: {
          type: 'object',
          description: 'A note.',
          not: { description: 'A shape a note never has.' },
          properties: { text: { type: 'string', description: 'Its text.' } },
        },
      },
    }

    expect(modelDescriptions(model)).toEqual([
      { at: ['description'], kind: 'model', place: 'model', text: 'The model.' },
      {
        at: ['allOf', 0, 'description'],
        kind: 'model',
        place: 'model allOf 0',
        text: 'A shape of the whole model.',
      },
      {
        at: ['$defs', 'note', 'description'],
        kind: 'entity',
        place: 'model entity note',
        text: 'A note.',
      },
      {
        at: ['$defs', 'note', 'not', 'description'],
        kind: 'entity',
        place: 'model entity note not',
        text: 'A shape a note never has.',
      },
      {
        at: ['$defs', 'note', 'properties', 'text', 'description'],
        kind: 'field',
        place: 'model field note.text',
        text: 'Its text.',
      },
    ])
  })
  it('quotes a name of a subschema that holds a space or a quote, so no two places read alike', () => {
    const model = {
      properties: {
        'a not': { description: 'First.' },
        a: { not: { description: 'Second.' } },
        'say "hi"': { description: 'A name with quotes.' },
        'back\\slash': { description: 'A name with a backslash.' },
        '': { description: 'An empty name.' },
        'a\ttab': { description: 'A name with a tab.' },
      },
    }

    expect(modelDescriptions(model).map(({ place }) => place)).toEqual([
      'model properties "a not"',
      'model properties a not',
      'model properties "say \\"hi\\""',
      'model properties back\\slash',
      'model properties ""',
      'model properties "a\\ttab"',
    ])
  })
})
