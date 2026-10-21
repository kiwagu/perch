import { DEFINE_TABLE } from './schema-structure'

/** A schema file: its path below the schema folder (`<database>/<name>.surql`) and its text. */
export interface SchemaFile {
  readonly path: string
  readonly text: string
}

/** The folder whose files every database applies. */
const COMMON = 'common'

/**
 * The databases each table lives in, by table, as the schema's folders say: a table defined in
 * `<database>/` lives in that database, one defined in `common/` in every database the schema
 * has. A shape runs on one database, so the tables it reads must share one.
 */
export function tableDatabases(
  files: readonly SchemaFile[],
): ReadonlyMap<string, readonly string[]> {
  const folderOf = (path: string): string => path.split('/')[0] ?? ''
  const databases = [...new Set(files.map(({ path }) => folderOf(path)))]
    .filter((folder) => folder !== COMMON)
    .sort()
  const tables = new Map<string, readonly string[]>()

  for (const { path, text } of files) {
    const folder = folderOf(path)
    const where = folder === COMMON ? databases : [folder]

    for (const line of text.split('\n')) {
      const table = DEFINE_TABLE.exec(line.trim())?.[1]

      if (table) {
        tables.set(table, [...new Set([...(tables.get(table) ?? []), ...where])].sort())
      }
    }
  }

  return tables
}
