import { readFileSync } from 'node:fs'

import { ResultAsync } from 'neverthrow'

import { type DataError, openLocalDb } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'
import { ACTIONS, type Scope, type TableAbilities, TENANT_ROLES } from '@workspace/kernel'

import { type FieldType, parseTypeString } from './type-string'

export type RegionName = 'private' | 'public' | 'tenant'

export type CrdtKind = 'text' | 'list' | 'counter'

export interface TableModel {
  readonly fields: Readonly<Record<string, FieldType>>
  readonly relation?: { readonly in: readonly string[]; readonly out: readonly string[] }
  readonly region?: RegionName
  readonly replicate?: 'none'
  readonly idPrefix?: string
  readonly crdt?: Readonly<Record<string, CrdtKind>>
  readonly abilities?: TableAbilities
}

export interface SchemaModel {
  readonly tables: Readonly<Record<string, TableModel>>
}

/** What `INFO FOR DB STRUCTURE` and `INFO FOR TABLE <t> STRUCTURE` report, reduced to what modeling reads. */
export interface StructureInfo {
  readonly db: {
    readonly tables: ReadonlyArray<{
      readonly name: string
      readonly kind: {
        readonly kind: string
        readonly in?: readonly string[]
        readonly out?: readonly string[]
      }
    }>
  }
  readonly tables: Readonly<
    Record<
      string,
      { readonly fields: ReadonlyArray<{ readonly name: string; readonly kind: string }> }
    >
  >
}

export interface SchemaResult {
  readonly model: SchemaModel
  readonly problems: readonly string[]
}

const REGIONS: ReadonlySet<string> = new Set(['private', 'public', 'tenant'])

const CRDT_KINDS: ReadonlySet<string> = new Set(['text', 'list', 'counter'])

/** A `DEFINE TABLE` statement at the start of a line, with the table's name. */
export const DEFINE_TABLE = /^DEFINE\s+TABLE\s+(?:OVERWRITE\s+|IF\s+NOT\s+EXISTS\s+)?(\w+)/i

const DEFINE_FIELD =
  /^DEFINE\s+FIELD\s+(?:OVERWRITE\s+|IF\s+NOT\s+EXISTS\s+)?([\w.*]+)\s+ON\s+(?:TABLE\s+)?(\w+)/i

interface Annotations {
  readonly tables: Map<string, Map<string, readonly string[]>>
  readonly fields: Map<string, Map<string, readonly string[]>>
}

/** Reads the `-- @name value` lines directly above each DEFINE TABLE and DEFINE FIELD; a name may repeat. */
function readAnnotations(schemaText: string): Annotations {
  const tables = new Map<string, Map<string, readonly string[]>>()
  const fields = new Map<string, Map<string, readonly string[]>>()
  let pending = new Map<string, string[]>()

  for (const raw of schemaText.split('\n')) {
    const line = raw.trim()
    const annotation = /^--\s*@(\w+)\s*(.*)$/.exec(line)

    if (annotation) {
      const name = annotation[1] ?? ''
      const values = pending.get(name) ?? []

      values.push((annotation[2] ?? '').trim())
      pending.set(name, values)

      continue
    }

    if (line.startsWith('--')) {
      continue
    }

    const table = DEFINE_TABLE.exec(line)
    const field = DEFINE_FIELD.exec(line)

    if (table?.[1]) {
      tables.set(table[1], pending)
    } else if (field?.[1] && field[2]) {
      fields.set(`${field[2]}.${field[1]}`, pending)
    }

    pending = new Map()
  }

  return { tables, fields }
}

const first = (own: ReadonlyMap<string, readonly string[]>, name: string): string | undefined =>
  own.get(name)?.[0]

type MutableObject = { kind: 'object'; fields: Record<string, FieldType> }

function objectOf(type: FieldType | undefined): MutableObject | undefined {
  const inner = type?.kind === 'option' ? type.inner : type

  return inner?.kind === 'object' ? (inner as MutableObject) : undefined
}

function buildFields(
  fields: ReadonlyArray<{ readonly name: string; readonly kind: string }>,
): Record<string, FieldType> {
  const top: Record<string, FieldType> = {}
  const ordered = [...fields]
    .filter((field) => !field.name.includes('*'))
    .sort((left, right) => left.name.split('.').length - right.name.split('.').length)

  for (const field of ordered) {
    const path = field.name.split('.')
    const leaf = path.pop() ?? field.name
    let container: Record<string, FieldType> | undefined = top

    for (const segment of path) {
      container = container ? objectOf(container[segment])?.fields : undefined
    }

    if (container) {
      container[leaf] = parseTypeString(field.kind)
    }
  }

  return top
}

function crdtProblem(
  table: string,
  field: string,
  kind: string,
  raw: string | undefined,
): string | undefined {
  const type = raw === undefined ? undefined : parseTypeString(raw)
  const inner = type?.kind === 'option' ? type.inner : type
  const fits =
    (kind === 'text' && inner?.kind === 'scalar' && inner.name === 'string') ||
    (kind === 'list' && inner?.kind === 'array') ||
    (kind === 'counter' &&
      inner?.kind === 'scalar' &&
      ['int', 'float', 'number'].includes(inner.name))
  const expected = kind === 'text' ? 'a string' : kind === 'list' ? 'an array' : 'a number'

  return fits
    ? undefined
    : `table ${table}: field ${field} is ${raw ?? 'undefined'}, a @crdt ${kind} field must be ${expected}`
}

const isRole = (value: string): value is (typeof TENANT_ROLES)[number] =>
  (TENANT_ROLES as readonly string[]).includes(value)

const isAction = (value: string): value is (typeof ACTIONS)[number] =>
  (ACTIONS as readonly string[]).includes(value)

/** The `-- @owner` field and the `-- @can <role> <actions>` lines of a table, or their problems. */
function parseAbilities(
  table: string,
  own: ReadonlyMap<string, readonly string[]>,
  rawFields: ReadonlyArray<{ readonly name: string; readonly kind: string }>,
  region: string | undefined,
  serverOnly: boolean,
  problems: string[],
): TableAbilities | undefined {
  const owner = first(own, 'owner')
  const lines = own.get('can') ?? []

  if (owner === undefined && lines.length === 0) {
    return undefined
  }

  if (serverOnly) {
    problems.push(
      `table ${table}: @owner and @can belong to a replicated table, not to -- @replicate none`,
    )

    return undefined
  }

  // Only an organisation's records are shared by members; a private or public table has none.
  if (region !== undefined && REGIONS.has(region) && region !== 'tenant') {
    problems.push(
      `table ${table}: @owner and @can belong to a tenant table; ${region} tables declare none`,
    )

    return undefined
  }

  if (
    owner !== undefined &&
    rawFields.find((field) => field.name === owner)?.kind !== 'record<member>'
  ) {
    problems.push(`table ${table}: -- @owner ${owner} must name a record<member> field`)
  }

  const can: Record<string, Record<string, Scope>> = {}

  for (const line of lines) {
    const match = /^(\w+)\s+(.+)$/.exec(line)
    const role = match?.[1]
    const list = match?.[2]

    if (!role || !list || !isRole(role)) {
      problems.push(
        `table ${table}: -- @can needs "<member|admin> <action>[:own], …", got "${line}"`,
      )

      continue
    }

    if (can[role]) {
      problems.push(`table ${table}: -- @can ${role} is declared twice`)

      continue
    }

    const scopes: Record<string, Scope> = {}

    for (const item of list
      .split(',')
      .map((part) => part.trim())
      .filter(Boolean)) {
      const [action, scope, ...rest] = item.split(':')

      if (
        !action ||
        !isAction(action) ||
        rest.length > 0 ||
        (scope !== undefined && scope !== 'own')
      ) {
        problems.push(`table ${table}: -- @can ${role}: unknown action "${item}"`)
      } else if (scope === 'own' && action === 'create') {
        problems.push(
          `table ${table}: -- @can ${role}: create:own is not allowed, a created record is owned by its author`,
        )
      } else if (scope === 'own' && owner === undefined) {
        problems.push(`table ${table}: -- @can ${role}: ${item} needs -- @owner <field>`)
      } else {
        scopes[action] = scope === 'own' ? 'own' : 'any'
      }
    }

    can[role] = scopes
  }

  return { ...(owner !== undefined ? { owner } : {}), can }
}

/** Builds the schema model from the database structure and the annotations in the schema text. */
export function parseStructure(info: StructureInfo, schemaText: string): SchemaResult {
  const annotations = readAnnotations(schemaText)
  const problems: string[] = []
  const tables: Record<string, TableModel> = {}

  for (const { name, kind } of info.db.tables) {
    const own = annotations.tables.get(name) ?? new Map<string, readonly string[]>()
    const region = first(own, 'region')
    const replicate = first(own, 'replicate')
    const idPrefix = first(own, 'id')
    const rawFields = info.tables[name]?.fields ?? []
    const crdt: Record<string, CrdtKind> = {}

    if (
      (region === undefined) === (replicate === undefined) ||
      (replicate !== undefined && replicate !== 'none')
    ) {
      problems.push(
        `table ${name}: declare exactly one of -- @region <private|public|tenant> or -- @replicate none`,
      )
    } else if (region !== undefined && !REGIONS.has(region)) {
      problems.push(`table ${name}: unknown region ${region}`)
    } else if (region !== undefined && !idPrefix) {
      problems.push(`table ${name}: a replicated table needs -- @id <prefix>`)
    }

    for (const field of rawFields) {
      const fieldKind = annotations.fields.get(`${name}.${field.name}`)?.get('crdt')?.[0]

      if (fieldKind === undefined) {
        continue
      }

      const problem = CRDT_KINDS.has(fieldKind)
        ? crdtProblem(name, field.name, fieldKind, field.kind)
        : `table ${name}: field ${field.name} has unknown @crdt ${fieldKind}`

      if (problem) {
        problems.push(problem)
      } else {
        crdt[field.name] = fieldKind as CrdtKind
      }
    }

    const abilities = parseAbilities(name, own, rawFields, region, replicate === 'none', problems)

    tables[name] = {
      fields: buildFields(rawFields),
      ...(kind.kind === 'RELATION' ? { relation: { in: kind.in ?? [], out: kind.out ?? [] } } : {}),
      ...(region !== undefined && REGIONS.has(region) ? { region: region as RegionName } : {}),
      ...(replicate === 'none' ? { replicate: 'none' as const } : {}),
      ...(idPrefix ? { idPrefix } : {}),
      ...(Object.keys(crdt).length > 0 ? { crdt } : {}),
      ...(abilities ? { abilities } : {}),
    }
  }

  return { model: { tables }, problems }
}

const read = (name: string): string =>
  readFileSync(new URL(`./surql/${name}`, import.meta.url), 'utf8')

/** Applies the schema to an embedded in-memory database and reads its structure back. */
export function loadSchemaModel(schemaText: string): ResultAsync<SchemaResult, DataError> {
  return openLocalDb({
    engines: nodeEngines(),
    url: 'mem://',
    namespace: 'modeling',
    database: 'modeling',
    schema: schemaText,
  }).andThen((local) => {
    const load = async (): Promise<SchemaResult> => {
      try {
        const [db] = (await local.db.query(read('info-db.surql'))) as [StructureInfo['db']]
        const tables: Record<string, { fields: Array<{ name: string; kind: string }> }> = {}

        for (const table of db.tables) {
          const [info] = (await local.db.query(read('info-table.surql'), {
            table: table.name,
          })) as [{ fields: Array<{ name: string; kind: string }> }]

          tables[table.name] = info
        }

        return parseStructure({ db, tables }, schemaText)
      } finally {
        await local.close()
      }
    }

    return ResultAsync.fromPromise(load(), (cause) => ({
      code: 'data:QUERY_FAILED' as const,
      message: 'could not read the schema structure',
      cause,
    }))
  })
}
