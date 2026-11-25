/**
 * The schema held to the model: each entity of `contract/domain/model.schema.json` is stored by
 * a table of the schema, which has its fields, its region, id prefix, crdt and read-only fields,
 * its owner and abilities and its unique sets, and whose `ASSERT` of each field states the
 * limits the model states, no more and no less. Synced writes rely on those asserts, so a limit
 * only the model knows lets a device write what the gateway then refuses.
 *
 * The schema is read as the database itself reports it (an embedded database applies it), so an
 * assert is read as the database prints it: `IN` comes back as `INSIDE`, a field that may be
 * `NONE` has the guard `$value = NONE OR ...`, and the clauses of an `AND` are joined on one line,
 * and a length bound that names a parameter is read for the number the parameter holds.
 *
 * The limits are those the kernel's generated values state for each field (`CONTRACT_VALUES`,
 * which resolves them as every reader of the contract does, a default length included), and the
 * schema's length parameters are generated from the same values. The values are held to the
 * contract by their own spec, now or, in the ahead mode, as they were at the base or the head of
 * the branch, so a business commit that changes a limit does not fail this spec before the
 * implementation emits the values and the parameters again. Likewise, on a branch
 * (`CONTRACT_AHEAD=1`) an entity the model declares now and did not declare at the branch's merge
 * base waits while the schema lacks the table the model names for it (`entities-ahead.ts`), and is
 * held once that table exists; on `main` and in `bun run check` every entity is held.
 */

import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { readSchema, type SchemaDatabase } from '@workspace/data/schema-files'
import { CONTRACT_VALUES } from '@workspace/kernel'
import { loadSchemaModel, type TableModel } from '@workspace/modeling'
import { loadResolvedModel, type ResolvedValue } from '@workspace/ui-contract'

import { entitiesAhead } from './__fixtures__/entities-ahead'
import { type Limits, readAssert } from './assert-limits'
import { lengthBoundProblems } from './length-bounds'

const ROOT = join(import.meta.dirname, '../..')

const DATABASES: readonly SchemaDatabase[] = ['directory', 'tenant']

/** The record's own id: every table has it without a field definition, so the structure lists none. */
const RECORD_ID = 'id'

/** The contract's values by name: every value of the platform and each field as `<entity>.<field>`. */
const VALUES: Readonly<Record<string, ResolvedValue>> = CONTRACT_VALUES

/**
 * The columns that hold no contract value, so write their length bound as a number: the id a
 * browser mints for itself and the label it describes itself with, neither a field of the model
 * nor a value of the platform. A column that holds a contract value names its parameter
 * (`$<value>_max_length`) instead; this list does not grow for it.
 */
const NO_CONTRACT_VALUE = ['device_session.device', 'device_session.label']

/**
 * The columns that hold a value of the platform, not a field of the model, so no entity holds them:
 * the schema's own column and the value it is held to.
 */
const PLATFORM_VALUE_COLUMNS = [
  { table: 'tenant', column: 'key', value: 'organisation-key' },
  { table: 'tenant', column: 'name', value: 'organisation-name' },
]

/** What the contract's value of a field limits it to, in the form an assert is read in. */
function valueLimits(value: ResolvedValue): Limits {
  return {
    ...(value.minLength === undefined ? {} : { min: value.minLength }),
    ...(value.maxLength === undefined ? {} : { max: value.maxLength }),
    email: value.format === 'email',
    ...(value.pattern === undefined ? {} : { pattern: value.pattern }),
    ...(value.enum === undefined ? {} : { members: value.enum.map(String).sort() }),
    unread: [],
  }
}

/** The columns a set of fields covers, whatever their order. */
const setOf = (fields: readonly string[]): string => [...fields].sort().join(',')

interface Schema {
  /** Every table of every database's schema by name, each as its database reports it. */
  readonly tables: ReadonlyMap<string, TableModel>
  /** The parameters the schema defines by name, each with the text the database holds. */
  readonly params: Readonly<Record<string, string>>
}

async function loadSchema(): Promise<Schema> {
  const tables = new Map<string, TableModel>()
  const allParams: Record<string, string> = {}

  for (const database of DATABASES) {
    const { model, params } = (await loadSchemaModel(readSchema(database)))._unsafeUnwrap()

    for (const [name, table] of Object.entries(model.tables)) {
      tables.set(name, table)
    }

    Object.assign(allParams, params)
  }

  return { tables, params: allParams }
}

const loaded = loadResolvedModel(ROOT)

if (loaded.model === undefined) {
  throw new Error(`the model does not load: ${JSON.stringify(loaded.problems)}`)
}

const schema = loadSchema()

/** The entities a business commit of the branch declared before their tables, while none exists. */
const waiting = entitiesAhead({
  declared: Object.values(loaded.model.entities),
  stored: new Set((await schema).tables.keys()),
  root: ROOT,
  env: process.env,
})

const entities = Object.values(loaded.model.entities).filter((entity) => !waiting.has(entity.name))

async function tableOf(name: string): Promise<TableModel> {
  const table = (await schema).tables.get(name)

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

  describe.each(Object.keys(entity.fields))('field %s', (name) => {
    it("has the limits of the contract's value of the field as its assert", async () => {
      const table = await tableOf(entity.table)
      const value = VALUES[`${entity.name}.${name}`]

      if (value === undefined) {
        throw new Error(`the contract's values have none for ${entity.name}.${name}`)
      }

      expect(readAssert(table.asserts[name], (await schema).params).limits).toEqual(
        valueLimits(value),
      )
    })
  })
})

describe('the length bounds of the schema', () => {
  it("name the parameters of the contract's values, but on the columns that hold none", async () => {
    const { tables, params } = await schema

    expect(
      lengthBoundProblems({ tables, params, values: VALUES, literal: NO_CONTRACT_VALUE }),
    ).toEqual([])
  })

  it.each(PLATFORM_VALUE_COLUMNS)(
    'holds $table $column to the limits of the platform value $value',
    async ({ table, column, value }) => {
      const found = VALUES[value]

      if (found === undefined) {
        throw new Error(`the contract's values have none named ${value}`)
      }

      expect(
        readAssert((await tableOf(table)).asserts[column], (await schema).params).limits,
      ).toEqual(valueLimits(found))
    },
  )
})
