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
  it("puts a table in its file's database, and a common table in every database", () => {
    const databases = tableDatabases([
      { path: 'directory/shelf.surql', text: '-- @region private\nDEFINE TABLE shelf SCHEMAFULL;' },
      { path: 'tenant/board.surql', text: 'DEFINE TABLE OVERWRITE board SCHEMAFULL;' },
      { path: 'common/log.surql', text: '  DEFINE TABLE IF NOT EXISTS log SCHEMALESS;' },
    ])

    expect(Object.fromEntries(databases)).toEqual({
      shelf: ['directory'],
      board: ['tenant'],
      log: ['directory', 'tenant'],
    })
  })

  it('maps the real schema: directory, tenant, and the replica tables of both', () => {
    const databases = tableDatabases(realSchema())

    expect(databases.get('profile')).toEqual(['directory'])
    expect(databases.get('identity')).toEqual(['directory'])
    expect(databases.get('note')).toEqual(['tenant'])
    expect(databases.get('member')).toEqual(['tenant'])
    expect(databases.get('_replica_update')).toEqual(['directory', 'tenant'])
  })
})
