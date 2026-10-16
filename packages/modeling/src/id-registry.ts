import type { SchemaModel } from './schema-structure'

/**
 * Cross-checks the `-- @id <prefix>` annotations of the schema against the entity
 * id registry in both directions. A registry checked only against itself cannot
 * see the mismatch that produces colliding or unroutable ids; the schema is the
 * independent source it is compared with.
 */
export function checkIdRegistry(
  schema: SchemaModel,
  prefixes: Readonly<Record<string, string>>,
): string[] {
  const problems: string[] = []

  for (const [name, table] of Object.entries(schema.tables)) {
    if (!table.idPrefix) {
      continue
    }

    const expected = prefixes[name]

    if (expected === undefined) {
      problems.push(
        `table ${name} declares -- @id ${table.idPrefix} but the id registry has no kind ${name}`,
      )
    } else if (expected !== table.idPrefix) {
      problems.push(
        `table ${name} declares -- @id ${table.idPrefix} but the id registry gives ${name} the prefix ${expected}`,
      )
    }
  }

  for (const [kind, prefix] of Object.entries(prefixes)) {
    const table = schema.tables[kind]

    if (!table) {
      problems.push(
        `the id registry declares ${kind} = ${prefix} but the schema has no table ${kind}`,
      )
    } else if (!table.idPrefix) {
      problems.push(
        `the id registry declares ${kind} = ${prefix} but table ${kind} has no -- @id ${prefix}`,
      )
    }
  }

  return problems
}
