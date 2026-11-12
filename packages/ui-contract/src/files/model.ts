/**
 * Reads `contract/domain/model.schema.json`: a JSON Schema 2020-12 document (checked against the
 * meta-schema) whose `$defs` are the entities, each through the entity schema.
 */

import { z } from '@workspace/zod'

import { DESCRIPTION_PURPOSES, entityDefinitionSchema, type entityFieldSchema } from '../schemas'

import { parseFile } from './parse-file'
import { MODEL_FILE } from './paths'
import type { Problem } from './problems'
import { readJson } from './read-json'
import { jsonSchemaProblems } from './validator'

export interface ModelField {
  type?: string
  enum?: readonly unknown[]
  /** The JSON Schema constraints a value typed into the field must meet. */
  minLength?: number
  maxLength?: number
  pattern?: string
  format?: string
  readonly: boolean
  crdt?: 'text' | 'list' | 'counter' | 'none'
  record?: string
  ref?: string
}

/** An action of an entity, under `x-perch.actions`. */
export interface ModelAction {
  description?: string
  /** Per parameter, the field it sets (`$id` for a new id). */
  params: Record<string, string>
  /** The platform actions whose answer differs once it succeeds; `[]`: none. */
  changes?: string[]
}

export interface ModelEntity {
  name: string
  table: string
  region: 'private' | 'tenant'
  id: string
  owner?: string
  can?: Record<string, Record<string, 'any' | 'own'>>
  actions: Record<string, ModelAction>
  unique: readonly (readonly string[])[]
  index: readonly (readonly string[])[]
  fields: Record<string, ModelField>
}

export interface Model {
  document: Record<string, unknown>
  entities: Record<string, ModelEntity>
}

/**
 * The document around the entities: a JSON Schema whose own keywords pass through, so its
 * `description`, the model's own, takes its purpose here, where the engine defines its shape.
 */
const documentSchema = z.looseObject({
  description: z.string().optional().describe(DESCRIPTION_PURPOSES.model),
  $defs: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.unknown()),
})

/** The constraints of a field's JSON Schema, which the meta-schema has checked already. */
function constraintsOf(field: Readonly<Record<string, unknown>>) {
  const { minLength, maxLength, pattern, format } = field

  return {
    ...(typeof minLength === 'number' ? { minLength } : {}),
    ...(typeof maxLength === 'number' ? { maxLength } : {}),
    ...(typeof pattern === 'string' ? { pattern } : {}),
    ...(typeof format === 'string' ? { format } : {}),
  }
}

function fieldOf(field: z.output<typeof entityFieldSchema>): ModelField {
  const perch = field['x-perch']

  return {
    ...(field.type === undefined ? {} : { type: field.type }),
    ...(field.enum === undefined ? {} : { enum: field.enum }),
    ...constraintsOf(field),
    readonly: perch?.readonly === true,
    ...(perch?.crdt === undefined ? {} : { crdt: perch.crdt }),
    ...(perch?.record === undefined ? {} : { record: perch.record }),
    ...(perch?.ref === undefined ? {} : { ref: perch.ref }),
  }
}

function entityOf(name: string, entity: z.output<typeof entityDefinitionSchema>): ModelEntity {
  const { owner, can, ...perch } = entity['x-perch']

  return {
    name,
    table: perch.table,
    region: perch.region,
    id: perch.id,
    ...(owner === undefined ? {} : { owner }),
    ...(can === undefined ? {} : { can }),
    actions: Object.fromEntries(
      Object.entries(perch.actions).map(([action, { description, params, changes }]) => [
        action,
        {
          ...(description === undefined ? {} : { description }),
          params,
          ...(changes === undefined ? {} : { changes }),
        },
      ]),
    ),
    unique: perch.unique,
    index: perch.index,
    fields: Object.fromEntries(
      Object.entries(entity.properties).map(([field, value]) => [field, fieldOf(value)]),
    ),
  }
}

export function loadModel(root: string): { model?: Model; problems: Problem[] } {
  const read = readJson(root, MODEL_FILE)

  if (read.json === undefined) {
    return { problems: read.problems }
  }

  const meta = jsonSchemaProblems(MODEL_FILE, read.json)
  const document = parseFile(MODEL_FILE, documentSchema, read.json)

  if (meta.length > 0 || document.value === undefined) {
    return { problems: [...meta, ...document.problems] }
  }

  const problems: Problem[] = []
  const entities: Record<string, ModelEntity> = {}

  for (const [name, definition] of Object.entries(document.value.$defs)) {
    const parsed = parseFile(MODEL_FILE, entityDefinitionSchema, definition, ['$defs', name])

    problems.push(...parsed.problems)

    if (parsed.value !== undefined) {
      entities[name] = entityOf(name, parsed.value)
    }
  }

  return problems.length > 0
    ? { problems }
    : { model: { document: document.value, entities }, problems }
}
