import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { tableDatabases } from './table-databases'

const SCHEMA_DIR = new URL('../../../database/schema/', import.meta.url)

/** Every file of the real schema, as `runModel` reads them. */
function realSchema() {
  return readdirSync(SCHEMA_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((folder) =>
      readdirSync(new URL(`${folder.name}/`, SCHEMA_DIR))
        .filter((name) => name.endsWith('.surql'))
        .map((name) => ({
          path: `${folder.name}/${name}`,
          text: readFileSync(new URL(`${folder.name}/${name}`, SCHEMA_DIR), 'utf8'),
        })),
    )
}

describe('tableDatabases', () => {
  it("puts a table in its file's database, and a common table in every database", async () => {
    const { databases, problems } = (
      await tableDatabases([
        { path: 'directory/shelf.surql', text: 'DEFINE TABLE shelf SCHEMAFULL;' },
        { path: 'tenant/board.surql', text: 'DEFINE TABLE OVERWRITE board SCHEMAFULL;' },
        { path: 'common/log.surql', text: 'DEFINE TABLE IF NOT EXISTS log SCHEMALESS;' },
      ])
    )._unsafeUnwrap()

    expect(Object.fromEntries(databases)).toEqual({
      shelf: ['directory'],
      board: ['tenant'],
      log: ['directory', 'tenant'],
    })
    expect(problems).toEqual([])
  })

  it('counts only the tables a database defines: a commented-out definition is none', async () => {
    const { databases } = (
      await tableDatabases([
        {
          path: 'directory/shelf.surql',
          text: 'DEFINE TABLE shelf SCHEMAFULL;\n/*\nDEFINE TABLE board SCHEMAFULL;\n*/',
        },
        { path: 'tenant/board.surql', text: 'DEFINE TABLE board SCHEMAFULL;' },
      ])
    )._unsafeUnwrap()

    expect(databases.get('board')).toEqual(['tenant'])
  })

  it('reports a schema file outside <database>/<name>.surql, which no database applies', async () => {
    const { databases, problems } = (
      await tableDatabases([
        { path: 'directory/shelf.surql', text: 'DEFINE TABLE shelf SCHEMAFULL;' },
        { path: 'tenant/nested/board.surql', text: 'DEFINE TABLE board SCHEMAFULL;' },
        { path: 'loose.surql', text: 'DEFINE TABLE loose SCHEMAFULL;' },
      ])
    )._unsafeUnwrap()

    expect(databases.has('board')).toBe(false)
    expect(databases.has('loose')).toBe(false)
    expect(problems).toEqual([
      'schema file tenant/nested/board.surql is not <database>/<name>.surql: no database applies it',
      'schema file loose.surql is not <database>/<name>.surql: no database applies it',
    ])
  })

  it('names the database whose schema cannot be applied', async () => {
    const failure = (
      await tableDatabases([
        { path: 'directory/shelf.surql', text: 'DEFINE TABLE shelf SCHEMAFULL;' },
        { path: 'tenant/board.surql', text: 'DEFINE TABLE board SCHEMAFULL TYPO;' },
      ])
    )._unsafeUnwrapErr()

    expect(failure.message).toBe('the schema of database tenant could not be applied')
  })

  it('maps the real schema: directory, tenant, and the replica tables of both', async () => {
    const { databases, problems } = (await tableDatabases(realSchema()))._unsafeUnwrap()

    expect(databases.get('profile')).toEqual(['directory'])
    expect(databases.get('identity')).toEqual(['directory'])
    expect(databases.get('note')).toEqual(['tenant'])
    expect(databases.get('member')).toEqual(['tenant'])
    expect(databases.get('_replica_update')).toEqual(['directory', 'tenant'])
    expect(problems).toEqual([])
  })
})
