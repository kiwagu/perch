import { describe, expect, it } from 'vitest'

import type { Model, ModelEntity } from '../model'
import type { Platform } from '../screens'
import type { ResolvedValue } from '../values'

import { attributedCodes, FIELD_CODE_SUFFIXES, failuresOf, type PlatformFailures } from '.'

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
        createThing: {
          params: { id: '$id', author: 'author', title: 'title', key: 'key' },
          changes: [],
        },
        renameThing: { params: { id: '$id', title: 'title' }, changes: [] },
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
      actions: { writeNote: { params: { id: '$id', body_text: 'body_text' }, changes: [] } },
      fields: { body_text: { type: 'string', format: 'email', readonly: false } },
    }),
  },
}

const PLATFORM: PlatformFailures = {
  'things.share': { codes: ['not-allowed', 'failed'], params: {} },
}

/** The edition before platform codes are attributed, and the one that attributes them. */
const BEFORE = 2
const ATTRIBUTING = 3

/** A platform with an action that renames a thing: its parameters, codes named after two of them. */
const RENAMING: Platform = {
  actions: {
    'things.rename': {
      description: 'Renames a thing.',
      params: {
        name: { value: 'n', description: 'The new name.' },
        currentPassword: { value: 'p', description: 'The password as it is.' },
        note: {
          type: 'string',
          codes: ['x-rejected', 'undeclared-rejected'],
          description: 'A note.',
        },
      },
      result: 'the thing has its new name',
      codes: [
        'name-too-long',
        'current-password-rejected',
        'x-rejected',
        'title-too-long',
        'failed',
      ],
      changes: [],
    },
  },
  reserved: [],
  status: { anchor: 'sample.status', states: ['ready'] },
}

const RENAMED = RENAMING.actions['things.rename']?.codes

describe('failuresOf', () => {
  const failureOf = failuresOf(MODEL, PLATFORM, BEFORE)

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

  it('names no code of a field after its enum, as before the suffixes were one table', () => {
    const closed = structuredClone(MODEL)
    const thing = closed.entities['thing']

    if (thing === undefined) {
      throw new Error('the model has no thing')
    }

    thing.fields['title'] = { type: 'string', enum: ['a', 'b'], readonly: false }

    expect(failuresOf(closed, PLATFORM, ATTRIBUTING)('thing.renameThing')).toEqual({
      codes: ['forbidden', 'failed'],
      params: {},
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
    expect(failuresOf(undefined, PLATFORM, BEFORE)('thing.createThing')).toBe('unloaded')
    expect(failuresOf(MODEL, undefined, BEFORE)('platform.things.share')).toBe('unloaded')
  })
})

/** `things.rename` writing its codes as a map, each with its condition or its invariant. */
const RENAMING_BY_MAP: Platform = {
  ...RENAMING,
  actions: {
    'things.rename': {
      ...(RENAMING.actions['things.rename'] as Platform['actions'][string]),
      codes: {
        'name-too-long': 'the new name is longer than its value allows',
        'current-password-rejected': { invariant: 'current-password' },
        'x-rejected': 'the note is refused',
        'title-too-long': 'the title is longer than it may be',
        failed: 'anything else fails',
      },
    },
  },
}

describe('failuresOf a platform action whose codes are a map', () => {
  it('gives the codes of the map in its order, attributed as a list of them would be', () => {
    expect(
      failuresOf(MODEL, RENAMING_BY_MAP.actions, ATTRIBUTING)('platform.things.rename'),
    ).toEqual({
      codes: RENAMED,
      params: {
        name: ['name-too-long'],
        currentPassword: ['current-password-rejected'],
        note: ['x-rejected'],
      },
    })
  })
})

describe('failuresOf and the parameters a platform code concerns', () => {
  it('attributes a code named after a parameter, and one its codes list, to that parameter', () => {
    expect(failuresOf(MODEL, RENAMING.actions, ATTRIBUTING)('platform.things.rename')).toEqual({
      codes: RENAMED,
      params: {
        name: ['name-too-long'],
        currentPassword: ['current-password-rejected'],
        note: ['x-rejected'],
      },
    })
  })

  it('attributes nothing before version 3, whatever the codes are named', () => {
    expect(failuresOf(MODEL, RENAMING.actions, BEFORE)('platform.things.rename')).toEqual({
      codes: RENAMED,
      params: {},
    })
    expect(failuresOf(MODEL, RENAMING.actions, 1)('platform.things.rename')).toEqual({
      codes: RENAMED,
      params: {},
    })
  })

  it('derives no code the action does not declare, and gives no parameter one named after another', () => {
    const attributed = Object.values(attributedCodes('platform.things.rename', RENAMING)).flat()

    expect(RENAMED).not.toContain('undeclared-rejected')
    expect(attributed).not.toContain('undeclared-rejected')
    expect(RENAMED).toContain('title-too-long')
    expect(attributed).not.toContain('title-too-long')
  })
})

describe('attributedCodes', () => {
  const platform = RENAMING

  it('gives the codes of each parameter of a platform action, as a binding names the action', () => {
    expect(attributedCodes('platform.things.rename', platform)).toEqual({
      name: ['name-too-long'],
      currentPassword: ['current-password-rejected'],
      note: ['x-rejected'],
    })
  })

  it('gives none for an action the platform does not declare, or one of the model', () => {
    expect(attributedCodes('platform.things.drop', platform)).toEqual({})
    expect(attributedCodes('things.rename', platform)).toEqual({})
    expect(attributedCodes('thing.renameThing', platform)).toEqual({})
  })
})

describe('FIELD_CODE_SUFFIXES', () => {
  const holds = (suffix: string, value: ResolvedValue) =>
    FIELD_CODE_SUFFIXES.find((row) => row.suffix === suffix)?.holds(value)

  it('lists the suffixes in the order a field gives its codes', () => {
    expect(FIELD_CODE_SUFFIXES.map(({ suffix }) => suffix)).toEqual([
      'required',
      'too-short',
      'too-long',
      'invalid',
      'taken',
      'rejected',
    ])
  })

  it('says whether a value has the constraint each suffix names', () => {
    expect(holds('required', { minLength: 1 })).toBe(true)
    expect(holds('required', { minLength: 10 })).toBe(true)
    expect(holds('required', { maxLength: 10 })).toBe(false)
    expect(holds('too-short', { minLength: 2 })).toBe(true)
    expect(holds('too-short', { minLength: 1 })).toBe(false)
    expect(holds('too-long', { maxLength: 80 })).toBe(true)
    expect(holds('too-long', { minLength: 1 })).toBe(false)
    expect(holds('invalid', { pattern: '^a' })).toBe(true)
    expect(holds('invalid', { format: 'email' })).toBe(true)
    expect(holds('invalid', { enum: ['a'] })).toBe(true)
    expect(holds('invalid', { maxLength: 80 })).toBe(false)
    expect(holds('taken', {})).toBe(true)
    expect(holds('rejected', { maximum: 3 })).toBe(true)
    expect(holds('rejected', { type: 'string' })).toBe(false)
  })
})
