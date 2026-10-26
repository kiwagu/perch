import { describe, expect, it } from 'vitest'

import type { Model, ModelEntity } from '../model'

import { failuresOf } from '.'

const entity = (overrides: Partial<ModelEntity>): ModelEntity => ({
  name: 'thing',
  table: 'thing',
  region: 'tenant',
  id: 'thg',
  actions: {},
  unique: [],
  index: [],
  fields: {},
  ...overrides,
})

const MODEL: Model = {
  document: {},
  entities: {
    thing: entity({
      can: { member: { create: 'any' } },
      actions: {
        createThing: { params: { id: '$id', author: 'author', title: 'title', key: 'key' } },
        renameThing: { params: { id: '$id', title: 'title' } },
      },
      unique: [['key'], ['title', 'author']],
      fields: {
        id: { type: 'string', readonly: true },
        author: { type: 'string', minLength: 1, readonly: true },
        title: { type: 'string', minLength: 1, maxLength: 80, readonly: false },
        key: { type: 'string', minLength: 2, pattern: '^[a-z]+$', readonly: false },
      },
    }),
    own_note: entity({
      name: 'own_note',
      actions: { writeNote: { params: { id: '$id', body_text: 'body_text' } } },
      fields: { body_text: { type: 'string', format: 'email', readonly: false } },
    }),
  },
}

const PLATFORM = { 'things.share': { codes: ['not-allowed', 'failed'] } }

describe('failuresOf', () => {
  const failureOf = failuresOf(MODEL, PLATFORM)

  it('gives a platform action the codes the platform declares', () => {
    expect(failureOf('platform.things.share')).toEqual({
      codes: ['not-allowed', 'failed'],
      params: {},
    })
  })

  it('gives an action of the model forbidden, the codes of the fields it sets, then failed', () => {
    expect(failureOf('thing.createThing')).toEqual({
      codes: [
        'forbidden',
        'title-required',
        'title-too-long',
        'key-too-short',
        'key-invalid',
        'key-taken',
        'failed',
      ],
      params: {
        title: ['title-required', 'title-too-long'],
        key: ['key-too-short', 'key-invalid', 'key-taken'],
      },
    })
    expect(failureOf('thing.renameThing')).toEqual({
      codes: ['forbidden', 'title-required', 'title-too-long', 'failed'],
      params: { title: ['title-required', 'title-too-long'] },
    })
  })

  it('leaves forbidden out for an entity that says nothing of who may change it', () => {
    expect(failureOf('own_note.writeNote')).toEqual({
      codes: ['body-text-invalid', 'failed'],
      params: { body_text: ['body-text-invalid'] },
    })
  })

  it('knows no action neither the model nor the platform has', () => {
    expect(failureOf('thing.dropThing')).toBeUndefined()
    expect(failureOf('nothing.createThing')).toBeUndefined()
    expect(failureOf('platform.things.drop')).toBeUndefined()
  })

  it('says unloaded while the file of the action does not load', () => {
    expect(failuresOf(undefined, PLATFORM)('thing.createThing')).toBe('unloaded')
    expect(failuresOf(MODEL, undefined)('platform.things.share')).toBe('unloaded')
  })
})
