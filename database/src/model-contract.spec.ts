/**
 * The schema held to the model: each entity of `contract/domain/model.schema.json` is stored by
 * a table of the schema, which has its fields, its region, id prefix, crdt and read-only fields,
 * its owner and abilities and its unique sets, and whose `ASSERT` of each field states the
 * limits the model states, no more and no less. Synced writes rely on those asserts, so a limit
 * only the model knows lets a device write what the gateway then refuses.
 *
 * The schema is read as the database itself reports it (an embedded database applies it), so an
 * assert is read as the database prints it: `IN` comes back as `INSIDE`, a field that may be
 * `NONE` has the guard `$value = NONE OR ...`, and the clauses of an `AND` are joined on one line.
 *
 * The model is read as every reader takes it: where the platform names a default length, a text
 * field that states no limit has it, so the database holds the field to that length too.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readSchema, type SchemaDatabase } from '@workspace/data/schema-files'
import { loadSchemaModel, type TableModel, tokenize } from '@workspace/modeling'
import { loadResolvedModel, type ModelField } from '@workspace/ui-contract'

const ROOT = join(import.meta.dirname, '../..')

const DATABASES: readonly SchemaDatabase[] = ['directory', 'tenant']

/** The record's own id: every table has it without a field definition, so the structure lists none. */
const RECORD_ID = 'id'

/** What a model field limits a value to, and what the `ASSERT` of its column limits it to. */
interface Limits {
  min?: number
  max?: number
  email: boolean
  pattern?: string
  members?: string[]
  /** Clauses of the assert this spec does not read: the model states nothing for them. */
  unread: string[]
}

const LENGTH = /^string::len\(\$value\) (>=|>|<=|<|=) (\d+)$/
const MATCHES = /^string::matches\(\$value, ('.*'|".*")\)$/
const INSIDE = /^\$value INSIDE \[(.*)\]$/

/** A SurrealQL string literal's text: the quotes off, `\\` and an escaped quote resolved. */
const unquote = (literal: string): string => literal.slice(1, -1).replace(/\\([\\'"])/g, '$1')

/** Splits `text` at each `keyword` outside quotes and brackets. */
function splitAt(text: string, keyword: 'AND' | 'OR'): string[] {
  const parts: string[] = []
  let depth = 0
  let from = 0

  for (const token of tokenize(text)) {
    if (token.kind === 'punct' && '([{'.includes(token.text)) {
      depth++
    } else if (token.kind === 'punct' && ')]}'.includes(token.text)) {
      depth--
    } else if (depth === 0 && token.kind === 'word' && token.text.toUpperCase() === keyword) {
      parts.push(text.slice(from, token.start).trim())
      from = token.end
    }
  }

  return [...parts, text.slice(from).trim()]
}

function modelLimits(field: ModelField): Limits {
  return {
    ...(field.minLength === undefined ? {} : { min: field.minLength }),
    ...(field.maxLength === undefined ? {} : { max: field.maxLength }),
    email: field.format === 'email',
    ...(field.pattern === undefined ? {} : { pattern: field.pattern }),
    ...(field.enum === undefined ? {} : { members: field.enum.map(String).sort() }),
    unread: [],
  }
}

/** Reads an assert as the database prints it: an optional field's `NONE` guard is no limit. */
function assertLimits(assert: string | undefined): Limits {
  const limits: Limits = { email: false, unread: [] }

  if (assert === undefined) {
    return limits
  }

  const [rule, ...others] = splitAt(assert, 'OR').filter((part) => part !== '$value = NONE')

  if (rule === undefined || others.length > 0) {
    return { ...limits, unread: [assert] }
  }

  for (const clause of splitAt(rule, 'AND')) {
    const length = LENGTH.exec(clause)
    const pattern = MATCHES.exec(clause)?.[1]
    const members = INSIDE.exec(clause)?.[1]

    if (length) {
      const bound = Number(length[2])
      const operator = length[1]

      if (operator === '>' || operator === '>=' || operator === '=') {
        limits.min = Math.max(limits.min ?? 0, operator === '>' ? bound + 1 : bound)
      }

      if (operator === '<' || operator === '<=' || operator === '=') {
        limits.max = Math.min(limits.max ?? bound, operator === '<' ? bound - 1 : bound)
      }
    } else if (clause === 'string::is_email($value)') {
      limits.email = true
    } else if (pattern !== undefined) {
      limits.pattern = unquote(pattern)
    } else if (members !== undefined) {
      limits.members = tokenize(members)
        .filter((token) => token.kind === 'string')
        .map((token) => unquote(token.text))
        .sort()
    } else {
      limits.unread.push(clause)
    }
  }

  return limits
}

/** The columns a set of fields covers, whatever their order. */
const setOf = (fields: readonly string[]): string => [...fields].sort().join(',')

/** Every table of every database's schema by name, each as its database reports it. */
async function loadTables(): Promise<ReadonlyMap<string, TableModel>> {
  const tables = new Map<string, TableModel>()

  for (const database of DATABASES) {
    const { model } = (await loadSchemaModel(readSchema(database)))._unsafeUnwrap()

    for (const [name, table] of Object.entries(model.tables)) {
      tables.set(name, table)
    }
  }

  return tables
}

const loaded = loadResolvedModel(ROOT)

if (loaded.model === undefined) {
  throw new Error(`the model does not load: ${JSON.stringify(loaded.problems)}`)
}

const entities = Object.values(loaded.model.entities)
const schema = loadTables()

async function tableOf(name: string): Promise<TableModel> {
  const table = (await schema).get(name)

  if (table === undefined) {
    throw new Error(`no database of the schema defines the table ${name}`)
  }

  return table
}

describe('the model', () => {
  it('names the entities the schema is held to', () => {
    expect(entities.length).toBeGreaterThan(0)
  })
})

describe.each(entities)('entity $name', (entity) => {
  it('is stored by the table the model names', async () => {
    expect(await tableOf(entity.table)).toBeDefined()
  })

  it('has every field of the model as a field of the table', async () => {
    const table = await tableOf(entity.table)
    const missing = Object.keys(entity.fields).filter(
      (name) => name !== RECORD_ID && !(name in table.fields),
    )

    expect(missing).toEqual([])
  })

  it('lives in the region and under the id prefix the model gives', async () => {
    const table = await tableOf(entity.table)

    expect({ region: table.region, idPrefix: table.idPrefix }).toEqual({
      region: entity.region,
      idPrefix: entity.id,
    })
  })

  it('marks the fields the model marks: crdt and read-only', async () => {
    const table = await tableOf(entity.table)
    const fields = Object.entries(entity.fields)
    const crdt = fields.flatMap(([name, field]) =>
      field.crdt === undefined || field.crdt === 'none' ? [] : [[name, field.crdt] as const],
    )
    const readonly = fields
      .filter(([name, field]) => field.readonly && name !== RECORD_ID)
      .map(([name]) => name)

    expect(Object.entries(table.crdt ?? {}).sort()).toEqual(crdt.sort())
    expect([...(table.readonlyFields ?? [])].sort()).toEqual(readonly.sort())
  })

  it('has the owner and the abilities the model gives', async () => {
    const table = await tableOf(entity.table)

    expect(table.abilities?.owner).toBe(entity.owner)
    expect(table.abilities?.can ?? {}).toEqual(entity.can ?? {})
  })

  it('holds each unique set of the model as a unique index', async () => {
    const table = await tableOf(entity.table)
    const unique = Object.values(table.indexes)
      .filter((index) => index.unique)
      .map((index) => setOf(index.fields))

    expect(entity.unique.filter((fields) => !unique.includes(setOf(fields)))).toEqual([])
  })

  describe.each(Object.entries(entity.fields))('field %s', (name, field) => {
    it('has the limits of the model as its assert', async () => {
      const table = await tableOf(entity.table)

      expect(assertLimits(table.asserts[name])).toEqual(modelLimits(field))
    })
  })
})
