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
})
