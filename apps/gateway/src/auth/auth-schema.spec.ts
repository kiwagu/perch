import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { getAuthTables } from 'better-auth/db'
import { okAsync } from 'neverthrow'
import { describe, expect, it } from 'vitest'

import { authOptions } from './auth-instance'

const SCHEMA_DIR = join(import.meta.dirname, '../../../../database/schema/directory')

/** Our columns beside Better Auth's, per table: each by name, with whether it may be left empty. */
const OURS: Record<string, Readonly<Record<string, boolean>>> = {
  device_session: { last_seen_at: false, ended_at: true, ended_reason: true },
}

interface Column {
  /** The type is `option<...>`: the column may be left empty. */
  readonly optional: boolean
  /** The column fills itself when a write leaves it empty. */
  readonly withDefault: boolean
}

/** The fields a committed schema file defines, by name. */
function definedFields(table: string): Map<string, Column> {
  const text = readFileSync(join(SCHEMA_DIR, `${table}.surql`), 'utf8')
  const fields = new Map<string, Column>()

  for (const match of text.matchAll(/DEFINE FIELD OVERWRITE (\w+) ON \w+ TYPE ([^;]+);/g)) {
    const definition = match[2] ?? ''

    fields.set(match[1] ?? '', {
      optional: definition.startsWith('option<'),
      withDefault: /\bDEFAULT\b/.test(definition),
    })
  }

  return fields
}

describe("the committed schema matches Better Auth's for our options", () => {
  const tables = getAuthTables(
    authOptions({
      local: {} as never, // never connected: only the options are read
      secret: 'test-secret-0123456789-0123456789-0123456789',
      baseURL: 'http://localhost/backend/auth',
      trustedOrigins: [],
      clock: { now: () => 0, schedule: () => () => {} },
      publicUrl: 'http://localhost',
      mail: { send: () => okAsync(undefined) },
      log: { error: () => {}, warn: () => {} },
    }),
  )

  it.each(Object.values(tables).map((table) => [table.modelName, table] as const))(
    'table %s defines exactly the fields Better Auth expects',
    (modelName, table) => {
      // Name -> whether the field may be left empty.
      const expected = new Map<string, boolean>()

      for (const [name, field] of Object.entries(table.fields)) {
        expected.set(field.fieldName ?? name, !(field.required ?? false))
      }

      for (const [own, optional] of Object.entries(OURS[modelName] ?? {})) {
        expected.set(own, optional)
      }

      expected.delete('id')

      // A field Better Auth may leave empty can be a plain column that fills itself.
      const defined = new Map(
        [...definedFields(modelName)].map(([name, column]) => [
          name,
          column.optional || (column.withDefault && expected.get(name) === true),
        ]),
      )

      expect(defined).toEqual(expected)
    },
  )
})
