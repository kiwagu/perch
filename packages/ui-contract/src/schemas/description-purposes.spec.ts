import { describe, expect, it } from 'vitest'

import { z } from '@workspace/zod'

import { isRecord } from '../records'

import { activitySchema } from './activity.schema'
import {
  DESCRIPTION_BUDGET,
  DESCRIPTION_PURPOSES,
  type DescriptionKind,
  descriptionLength,
} from './description-purposes'
import { entityDefinitionSchema } from './entity.schema'
import { authoredScreenFileSchema, platformFileSchema } from './screens-schema'

/** The JSON Schema `contract:schemas` writes for a file of the contract. */
const jsonSchemaOf = (schema: z.ZodType): unknown =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })

/** Every record of a JSON value, depth first. */
function recordsIn(node: unknown): Array<Readonly<Record<string, unknown>>> {
  if (Array.isArray(node)) {
    return node.flatMap((each: unknown) => recordsIn(each))
  }

  return isRecord(node) ? [node, ...Object.values(node).flatMap(recordsIn)] : []
}

/** Every text a JSON Schema describes something with. */
const textsOf = (schema: z.ZodType): Set<string> =>
  new Set(
    recordsIn(jsonSchemaOf(schema)).flatMap(({ description }) =>
      typeof description === 'string' ? [description] : [],
    ),
  )

/** The hint a JSON Schema gives each property named `description`, wherever it sits. */
const fieldHintsOf = (schema: z.ZodType): Set<string> =>
  new Set(
    recordsIn(jsonSchemaOf(schema)).flatMap(({ properties }) => {
      const field = isRecord(properties) ? properties['description'] : undefined
      const hint = isRecord(field) ? field['description'] : undefined

      return typeof hint === 'string' ? [hint] : []
    }),
  )

const purposes = (...kinds: DescriptionKind[]): string[] =>
  kinds.map((kind) => DESCRIPTION_PURPOSES[kind])

/** The description fields of each file the contract authors, by the kind of each. */
const FILES: ReadonlyArray<{
  file: string
  schema: z.ZodType
  fields: DescriptionKind[]
  meanings: DescriptionKind[]
}> = [
  {
    file: 'a screen file',
    schema: authoredScreenFileSchema,
    fields: ['screen', 'anchor', 'flow', 'state', 'region', 'transition', 'parameter'],
    meanings: ['containerState', 'guard'],
  },
  {
    file: 'the platform file',
    schema: platformFileSchema,
    fields: ['action', 'actionParameter', 'composite'],
    meanings: ['event'],
  },
  {
    file: 'an activity file',
    schema: activitySchema,
    fields: ['activity', 'activityData', 'visit', 'activityTransition'],
    meanings: ['activityGuard'],
  },
  {
    file: 'an entity of the model',
    schema: entityDefinitionSchema,
    fields: ['entity', 'field', 'modelAction'],
    meanings: [],
  },
]

describe('DESCRIPTION_PURPOSES', () => {
  it('ends every purpose with the one budget all descriptions keep', () => {
    expect(DESCRIPTION_BUDGET).toBe(200)

    for (const purpose of Object.values(DESCRIPTION_PURPOSES)) {
      expect(purpose).toMatch(/ At most 200 characters\.$/)
    }
  })

  for (const { file, schema, fields } of FILES) {
    it(`gives each description field of ${file} its purpose as the hint of its JSON Schema`, () => {
      expect([...fieldHintsOf(schema)].sort()).toEqual(purposes(...fields).sort())
    })
  }
  for (const { file, schema, meanings } of FILES.filter(({ meanings }) => meanings.length > 0)) {
    it(`gives each meaning ${file} writes in a map its purpose too`, () => {
      const texts = textsOf(schema)

      for (const purpose of purposes(...meanings)) {
        expect(texts.has(purpose)).toBe(true)
      }
    })
  }
})

describe('descriptionLength', () => {
  it('counts the characters of a description, as its budget does', () => {
    expect(descriptionLength('The theme of this device.')).toBe(25)
    expect(descriptionLength('a é 😀')).toBe(5)
  })
})
