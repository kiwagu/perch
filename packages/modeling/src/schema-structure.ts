import { readFileSync } from 'node:fs'

import { ResultAsync } from 'neverthrow'

import { type DataError, openLocalDb } from '@workspace/data'
import { nodeEngines } from '@workspace/data/engines/node'

import { type FieldType, parseTypeString } from './type-string'

export type RegionName = 'private' | 'public' | 'org'

export type CrdtKind = 'text' | 'list' | 'counter'

export interface TableModel {
  readonly fields: Readonly<Record<string, FieldType>>
  readonly relation?: { readonly in: readonly string[]; readonly out: readonly string[] }
  readonly region?: RegionName
  readonly replicate?: 'none'
  readonly idPrefix?: string
  readonly crdt?: Readonly<Record<string, CrdtKind>>
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

const REGIONS: ReadonlySet<string> = new Set(['private', 'public', 'org'])

const CRDT_KINDS: ReadonlySet<string> = new Set(['text', 'list', 'counter'])

const DEFINE_TABLE = /^DEFINE\s+TABLE\s+(?:OVERWRITE\s+|IF\s+NOT\s+EXISTS\s+)?(\w+)/i

const DEFINE_FIELD =
  /^DEFINE\s+FIELD\s+(?:OVERWRITE\s+|IF\s+NOT\s+EXISTS\s+)?([\w.*]+)\s+ON\s+(?:TABLE\s+)?(\w+)/i

interface Annotations {
  readonly tables: Map<string, Map<string, string>>
  readonly fields: Map<string, Map<string, string>>
}

/** Reads the `-- @name value` lines directly above each DEFINE TABLE and DEFINE FIELD. */
function readAnnotations(schemaText: string): Annotations {
  const tables = new Map<string, Map<string, string>>()
  const fields = new Map<string, Map<string, string>>()
  let pending = new Map<string, string>()

  for (const raw of schemaText.split('\n')) {
    const line = raw.trim()
    const annotation = /^--\s*@(\w+)\s*(.*)$/.exec(line)

    if (annotation) {
      pending.set(annotation[1] ?? '', (annotation[2] ?? '').trim())

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

/** Builds the schema model from the database structure and the annotations in the schema text. */
export function parseStructure(info: StructureInfo, schemaText: string): SchemaResult {
  const annotations = readAnnotations(schemaText)
  const problems: string[] = []
  const tables: Record<string, TableModel> = {}

  for (const { name, kind } of info.db.tables) {
    const own = annotations.tables.get(name) ?? new Map<string, string>()
    const region = own.get('region')
    const replicate = own.get('replicate')
    const idPrefix = own.get('id')
    const rawFields = info.tables[name]?.fields ?? []
    const crdt: Record<string, CrdtKind> = {}

    if (
      (region === undefined) === (replicate === undefined) ||
      (replicate !== undefined && replicate !== 'none')
    ) {
      problems.push(
        `table ${name}: declare exactly one of -- @region <private|public|org> or -- @replicate none`,
      )
    } else if (region !== undefined && !REGIONS.has(region)) {
      problems.push(`table ${name}: unknown region ${region}`)
    } else if (region !== undefined && !idPrefix) {
      problems.push(`table ${name}: a replicated table needs -- @id <prefix>`)
    }

    for (const field of rawFields) {
      const fieldKind = annotations.fields.get(`${name}.${field.name}`)?.get('crdt')

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

    tables[name] = {
      fields: buildFields(rawFields),
      ...(kind.kind === 'RELATION' ? { relation: { in: kind.in ?? [], out: kind.out ?? [] } } : {}),
      ...(region !== undefined && REGIONS.has(region) ? { region: region as RegionName } : {}),
      ...(replicate === 'none' ? { replicate: 'none' as const } : {}),
      ...(idPrefix ? { idPrefix } : {}),
      ...(Object.keys(crdt).length > 0 ? { crdt } : {}),
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
