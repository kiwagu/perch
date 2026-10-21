import { ResultAsync } from 'neverthrow'

import type { DataError } from '@workspace/data'

import { loadSchemaModel } from './schema-structure'

/** A schema file: its path below the schema folder (`<database>/<name>.surql`) and its text. */
export interface SchemaFile {
  readonly path: string
  readonly text: string
}

export interface TableDatabases {
  /** The databases each table lives in, by table. */
  readonly databases: ReadonlyMap<string, readonly string[]>
  /** The schema files outside `<database>/<name>.surql`, which no database applies. */
  readonly problems: readonly string[]
}

/** The folder whose files every database applies. */
const COMMON = 'common'

/** A schema file a database applies, with the folder it belongs to. */
const LAYOUT = /^([^/]+)\/[^/]+\.surql$/

/**
 * The databases each table lives in, as each database itself defines them: a database's schema
 * (the `common/` files, then its own folder's, each in name order, as `readSchema` composes it)
 * is applied to an embedded database of its own and its tables are read back, so a definition in
 * a comment counts for nothing. A shape runs on one database, so the tables it reads must share
 * one. A file outside `<database>/<name>.surql` belongs to no database and is reported.
 */
export function tableDatabases(
  files: readonly SchemaFile[],
): ResultAsync<TableDatabases, DataError> {
  const problems: string[] = []
  const byFolder = new Map<string, SchemaFile[]>()

  for (const file of files) {
    const folder = LAYOUT.exec(file.path)?.[1]

    if (folder === undefined) {
      problems.push(
        `schema file ${file.path} is not <database>/<name>.surql: no database applies it`,
      )
    } else {
      byFolder.set(folder, [...(byFolder.get(folder) ?? []), file])
    }
  }

  const texts = (folder: string): string[] =>
    [...(byFolder.get(folder) ?? [])]
      .sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
      .map(({ text }) => text)
  const databases = [...byFolder.keys()].filter((folder) => folder !== COMMON).sort()

  return ResultAsync.combine(
    databases.map((database) =>
      loadSchemaModel([...texts(COMMON), ...texts(database)].join('\n')).map(({ model }) => ({
        database,
        tables: Object.keys(model.tables),
      })),
    ),
  ).map((loaded) => {
    const tables = new Map<string, string[]>()

    for (const { database, tables: defined } of loaded) {
      for (const table of defined) {
        tables.set(table, [...(tables.get(table) ?? []), database])
      }
    }

    return { databases: tables, problems }
  })
}
