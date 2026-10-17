/**
 * The schema of one database as one SurrealQL text: the files every database shares
 * (`database/schema/common`) and then the database's own, each set in name order. Bun and
 * Node only; a browser bundle imports the files instead.
 */

import { readdirSync, readFileSync } from 'node:fs'

const SCHEMA_DIR = new URL('../../../database/schema/', import.meta.url)

export type SchemaDatabase = 'directory' | 'tenant'

function filesOf(dir: string): string[] {
  const at = new URL(`${dir}/`, SCHEMA_DIR)

  return readdirSync(at)
    .filter((name) => name.endsWith('.surql'))
    .sort()
    .map((name) => readFileSync(new URL(name, at), 'utf8'))
}

export function readSchema(database: SchemaDatabase): string {
  return [...filesOf('common'), ...filesOf(database)].join('\n')
}
