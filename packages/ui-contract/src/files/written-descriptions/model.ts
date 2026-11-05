/**
 * The descriptions the model writes, `contract/domain/model.schema.json`: the model's own, each
 * entity's, each action's of its `x-perch.actions` and each field's, the subschemas of a field
 * included, found where JSON Schema puts a subschema: a keyword holding one (`items`, `not`,
 * `additionalProperties`, ...), a list of them (`anyOf`, `prefixItems`, ...) or a map of them by
 * name (`properties`, `$defs`, ...). Any other keyword holds none (`x-perch`, a keyword whose value
 * is data: `default`, `examples`, `const`, `enum`), while a subfield of any name is read, one
 * named `description` or `default` included.
 */

import { entriesOf, isRecord, recordOf } from '../../records'

import { describedAt, type Found, isList } from './found'

/** The keywords whose value is one subschema (`items` may be a list of them too). */
const ONE_SCHEMA = new Set([
  'additionalItems',
  'additionalProperties',
  'contains',
  'contentSchema',
  'else',
  'if',
  'items',
  'not',
  'propertyNames',
  'then',
  'unevaluatedItems',
  'unevaluatedProperties',
])

/** The keywords whose value is a list of subschemas. */
const SCHEMA_LIST = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems'])

/** The keywords whose value maps names to subschemas. */
const SCHEMA_MAP = new Set([
  '$defs',
  'definitions',
  'dependentSchemas',
  'patternProperties',
  'properties',
])

type Subschema = [readonly PropertyKey[], unknown]

/** The records of a list, each by its position under `key`. */
const listed = (key: string, value: readonly unknown[]): Subschema[] =>
  value.flatMap((item, index): Subschema[] => (isRecord(item) ? [[[key, index], item]] : []))

/** The subschemas of a JSON Schema, each by the keys that lead to it from the schema. */
function subschemasOf(schema: unknown): Subschema[] {
  return entriesOf(schema).flatMap(([key, value]): Subschema[] => {
    if (ONE_SCHEMA.has(key)) {
      if (isList(value)) {
        return listed(key, value)
      }

      return isRecord(value) ? [[[key], value]] : []
    }

    if (SCHEMA_LIST.has(key)) {
      return isList(value) ? listed(key, value) : []
    }

    if (SCHEMA_MAP.has(key)) {
      return entriesOf(value).flatMap(([name, subschema]): Subschema[] =>
        isRecord(subschema) ? [[[key, name], subschema]] : [],
      )
    }

    return []
  })
}

/** The descriptions of a JSON Schema at `at`, its own and its subschemas', all of one kind. */
const schemaAt = (
  schema: unknown,
  at: readonly PropertyKey[],
  kind: 'entity' | 'field' | 'model',
  place: string,
): Found[] => [
  ...describedAt(schema, at, kind, place),
  ...besideAt(schema, at, kind, place, new Set()),
]

/**
 * The descriptions of the subschemas of `schema` at `at`, save those under a keyword in
 * `handled`, which the caller reads as what they are (the entities of the document's `$defs`,
 * the fields of an entity's `properties`).
 */
const besideAt = (
  schema: unknown,
  at: readonly PropertyKey[],
  kind: 'entity' | 'field' | 'model',
  place: string,
  handled: ReadonlySet<string>,
): Found[] =>
  subschemasOf(schema)
    .filter(([keys]) => !handled.has(String(keys[0])))
    .flatMap(([keys, subschema]) =>
      schemaAt(subschema, [...at, ...keys], kind, `${place} ${keys.map(String).join(' ')}`),
    )

/** The descriptions of the entity `name` at `$defs.<name>`. */
function entityAt(name: string, entity: unknown): Found[] {
  const at = ['$defs', name]
  const place = `model entity ${name}`
  const { properties } = recordOf(entity)

  return [
    ...describedAt(entity, at, 'entity', place),
    ...entriesOf(recordOf(recordOf(entity)['x-perch'])['actions']).flatMap(([action, def]) =>
      describedAt(
        def,
        [...at, 'x-perch', 'actions', action],
        'modelAction',
        `model action ${name}.${action}`,
      ),
    ),
    ...besideAt(entity, at, 'entity', place, new Set(['properties'])),
    ...entriesOf(properties).flatMap(([field, schema]) =>
      schemaAt(schema, [...at, 'properties', field], 'field', `model field ${name}.${field}`),
    ),
  ]
}

/**
 * The descriptions the model document `value` writes: its own, those of its other subschemas,
 * then its entities'.
 */
export const modelDescriptions = (value: unknown): Found[] => [
  ...describedAt(value, [], 'model', 'model'),
  ...besideAt(value, [], 'model', 'model', new Set(['$defs'])),
  ...entriesOf(recordOf(value)['$defs']).flatMap(([name, entity]) => entityAt(name, entity)),
]
