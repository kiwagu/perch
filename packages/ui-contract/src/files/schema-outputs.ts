/**
 * The JSON Schemas beside the contract files, generated from their Zod sources and
 * committed: editors validate the files with them, and a schema that differs from its
 * source is drift.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from '@workspace/zod'

import {
  entityDefinitionSchema,
  manifestSchema,
  platformFileSchema,
  screenFileSchema,
} from '../schemas'

import {
  ENTITY_SCHEMA_FILE,
  MANIFEST_SCHEMA_FILE,
  PLATFORM_SCHEMA_FILE,
  SCREEN_SCHEMA_FILE,
} from './paths'
import type { Problem } from './problems'

/** The authored shape (`io: 'input'`): a field with a default is optional to write. */
const jsonSchemaOf = (schema: z.ZodType): object =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })

export const SCHEMA_OUTPUTS: ReadonlyArray<{ file: string; schema: () => object }> = [
  { file: SCREEN_SCHEMA_FILE, schema: () => jsonSchemaOf(screenFileSchema) },
  { file: PLATFORM_SCHEMA_FILE, schema: () => jsonSchemaOf(platformFileSchema) },
  { file: ENTITY_SCHEMA_FILE, schema: () => jsonSchemaOf(entityDefinitionSchema) },
  { file: MANIFEST_SCHEMA_FILE, schema: () => jsonSchemaOf(manifestSchema) },
]

const textOf = (schema: object): string => `${JSON.stringify(schema, null, 2)}\n`

/** Writes the schemas under `root`; returns the files written. */
export function writeSchemas(root: string): string[] {
  return SCHEMA_OUTPUTS.map(({ file, schema }) => {
    const path = join(root, file)

    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, textOf(schema()))

    return file
  })
}

/** A committed schema that is missing or differs from what its source generates. */
export function schemaDrift(root: string): Problem[] {
  return SCHEMA_OUTPUTS.flatMap(({ file, schema }): Problem[] => {
    const path = join(root, file)

    if (!existsSync(path)) {
      return [{ file, message: 'is missing; run `bun run contract:schemas`' }]
    }

    return readFileSync(path, 'utf8') === textOf(schema())
      ? []
      : [{ file, message: 'differs from its Zod source; run `bun run contract:schemas`' }]
  })
}
