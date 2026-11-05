/**
 * The descriptions the model writes, `contract/domain/model.schema.json`: the model's own, each
 * entity's, each action's of its `x-perch.actions` and each field's, the subschemas of a field
 * (the `items` of a list, the `properties` of an object) included. Another key of `x-perch` and a
 * keyword whose value is data (`default`, `examples`, `const`, `enum`) hold none, so a parameter
 * or a value named `description` is never read as one.
 */

import { entriesOf, isRecord, recordOf } from '../../records'

import { describedAt, type Found, isList } from './found'

const DATA_KEYWORDS = new Set(['const', 'default', 'enum', 'examples'])

/** The subschemas of a JSON Schema, each by the keys that lead to it from the schema. */
function subschemasOf(schema: unknown): Array<[readonly PropertyKey[], unknown]> {
  return entriesOf(schema).flatMap(([key, value]): Array<[readonly PropertyKey[], unknown]> => {
    if (key === 'description' || key.startsWith('x-') || DATA_KEYWORDS.has(key)) {
      return []
    }

    if (isList(value)) {
      return value.flatMap(
        (item, index): Array<[readonly PropertyKey[], unknown]> =>
          isRecord(item) ? [[[key, index], item]] : [],
      )
    }

    return isRecord(value) ? [[[key], value]] : []
  })
}

/** The descriptions of a field's JSON Schema at `at`, its own and its subschemas'. */
const fieldAt = (schema: unknown, at: readonly PropertyKey[], place: string): Found[] => [
  ...describedAt(schema, at, 'field', place),
  ...subschemasOf(schema).flatMap(([keys, subschema]) =>
    fieldAt(subschema, [...at, ...keys], `${place} ${keys.map(String).join(' ')}`),
  ),
]

/** The descriptions of the entity `name` at `$defs.<name>`. */
function entityAt(name: string, entity: unknown): Found[] {
  const at = ['$defs', name]
  const { properties } = recordOf(entity)

  return [
    ...describedAt(entity, at, 'entity', `model entity ${name}`),
    ...entriesOf(recordOf(recordOf(entity)['x-perch'])['actions']).flatMap(([action, def]) =>
      describedAt(
        def,
        [...at, 'x-perch', 'actions', action],
        'modelAction',
        `model action ${name}.${action}`,
      ),
    ),
    ...entriesOf(properties).flatMap(([field, schema]) =>
      fieldAt(schema, [...at, 'properties', field], `model field ${name}.${field}`),
    ),
  ]
}

/** The descriptions the model document `value` writes, in the order of the file. */
export const modelDescriptions = (value: unknown): Found[] => [
  ...describedAt(value, [], 'model', 'model'),
  ...entriesOf(recordOf(value)['$defs']).flatMap(([name, entity]) => entityAt(name, entity)),
]
