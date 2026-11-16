/**
 * The JSON Schemas beside the contract files, generated from their Zod sources and
 * committed: editors validate the files with them, and a schema that differs from its
 * source is drift. The reference of every key and rule is written with them
 * (`renderReference`), and its drift is the reference's own (`referenceDrift`).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { z } from '@workspace/zod'

import { renderReference } from '../reference'
import {
  activitySchema,
  authoredScreenFileSchema,
  entityDefinitionSchema,
  manifestSchema,
  platformFileSchema,
} from '../schemas'

import {
  ACTIVITY_SCHEMA_FILE,
  ENTITY_SCHEMA_FILE,
  MANIFEST_SCHEMA_FILE,
  PLATFORM_SCHEMA_FILE,
  REFERENCE_FILE,
  SCREEN_SCHEMA_FILE,
} from './paths'
import type { Problem } from './problems'

/** The authored shape (`io: 'input'`): a field with a default is optional to write. */
const jsonSchemaOf = (schema: z.ZodType): object =>
  z.toJSONSchema(schema, { target: 'draft-2020-12', io: 'input' })

export const SCHEMA_OUTPUTS: ReadonlyArray<{ file: string; schema: () => object }> = [
  { file: SCREEN_SCHEMA_FILE, schema: () => jsonSchemaOf(authoredScreenFileSchema) },
  { file: PLATFORM_SCHEMA_FILE, schema: () => jsonSchemaOf(platformFileSchema) },
  { file: ACTIVITY_SCHEMA_FILE, schema: () => jsonSchemaOf(activitySchema) },
  { file: ENTITY_SCHEMA_FILE, schema: () => jsonSchemaOf(entityDefinitionSchema) },
  { file: MANIFEST_SCHEMA_FILE, schema: () => jsonSchemaOf(manifestSchema) },
]

const textOf = (schema: object): string => `${JSON.stringify(schema, null, 2)}\n`

/** Writes `text` into `file` under `root`, making its folder; returns the file. */
function written(root: string, file: string, text: string): string {
  const path = join(root, file)

  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, text)

  return file
}

/** Writes the schemas under `root`, then the reference; returns the files written. */
export function writeSchemas(root: string): string[] {
  return [
    ...SCHEMA_OUTPUTS.map(({ file, schema }) => written(root, file, textOf(schema()))),
    written(root, REFERENCE_FILE, renderReference()),
  ]
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
