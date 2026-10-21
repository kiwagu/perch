/**
 * One entity of `contract/model.schema.json` (an entry of `$defs`): a JSON Schema object
 * with the contract's `x-perch` keyword, which says where the entity lives, who may change
 * it, the actions on it and how each field merges. Other JSON Schema keywords pass through.
 */

import { z } from '@workspace/zod'

import { roleSchema } from '../names.schema'

const fieldNameSchema = z.string().regex(/^[a-z][a-z0-9_]*$/)

const fieldPerchSchema = z
  .strictObject({
    readonly: z.boolean().optional().describe('No action changes the field once it is created.'),
    crdt: z
      .enum(['text', 'list', 'counter', 'none'])
      .optional()
      .describe('How concurrent edits merge; `none` for last-writer-wins.'),
    record: z.string().optional().describe('The table a record link points to.'),
    ref: z.string().optional().describe('The entity of the model the field refers to.'),
  })
  .describe('How the field is stored and merged.')

export const entityFieldSchema = z
  .looseObject({
    type: z.string().optional().describe('The JSON Schema type of the field.'),
    description: z.string().optional().describe('What the field holds.'),
    enum: z.array(z.unknown()).optional().describe('The values the field takes.'),
    'x-perch': fieldPerchSchema.optional(),
  })
  .describe('One field of the entity, a JSON Schema.')

const actionSchema = z
  .strictObject({
    description: z.string().optional().describe('What the action does.'),
    params: z
      .record(z.string(), z.string())
      .describe('Per parameter, the field it sets (`$id` for a new id).'),
  })
  .describe('One action on the entity.')

const keysSchema = z.array(z.array(fieldNameSchema).min(1)).default([])

const entityPerchSchema = z
  .strictObject({
    table: fieldNameSchema.describe('The table of the entity.'),
    region: z
      .enum(['private', 'tenant'])
      .describe('Where the entity lives: the account private region or the organisation one.'),
    id: z
      .string()
      .regex(/^[a-z]{3}$/)
      .describe('The id prefix of the entity, from the id registry.'),
    owner: fieldNameSchema.optional().describe('The field that names the owner of an entry.'),
    can: z
      .record(roleSchema, z.record(z.string(), z.enum(['any', 'own'])))
      .optional()
      .describe('Per role, per operation: on any entry or only on its own.'),
    actions: z.record(z.string(), actionSchema).describe('The actions on the entity by name.'),
    unique: keysSchema.describe('The field sets that are unique.'),
    index: keysSchema.describe('The field sets that are indexed.'),
  })
  .describe('What the contract says about the entity beyond its shape.')

export const entityDefinitionSchema = z
  .looseObject({
    type: z.literal('object').describe('Always "object".'),
    description: z.string().optional().describe('What the entity is.'),
    'x-perch': entityPerchSchema,
    properties: z.record(fieldNameSchema, entityFieldSchema).describe('The fields by name.'),
    required: z.array(fieldNameSchema).describe('The fields every entry has.'),
    additionalProperties: z.literal(false).describe('Always false: no other field.'),
  })
  .superRefine((entity, context) => {
    for (const [name, field] of Object.entries(entity.properties)) {
      const perch = field['x-perch']

      if (field.type === 'string' && perch?.readonly !== true && perch?.crdt === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['properties', name],
          message:
            'a string field that is not readonly needs x-perch.crdt ("none" for last-writer-wins)',
        })
      }
    }
  })
  .describe('One entity of the data model.')
