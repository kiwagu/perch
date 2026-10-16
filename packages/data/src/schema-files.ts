/**
 * The shared schema as one SurrealQL text: every `database/schema/*.surql` file in
 * name order. Bun and Node only; a browser bundle imports the files instead.
 */

import { readdirSync, readFileSync } from 'node:fs'

const SCHEMA_DIR = new URL('../../../database/schema/', import.meta.url)

export function readSchema(): string {
  return readdirSync(SCHEMA_DIR)
    .filter((name) => name.endsWith('.surql'))
    .sort()
    .map((name) => readFileSync(new URL(name, SCHEMA_DIR), 'utf8'))
    .join('\n')
}
