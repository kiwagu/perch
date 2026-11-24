/**
 * Reads `contract/domain/terms.yaml` through `termsFileSchema`: the contexts, the terms and the
 * roles, with the line of each key and item. A contract may leave the file out, and then has no
 * terms and keeps its roles in the vocabulary; a file that is not YAML or that the schema refuses
 * is a problem of that file, and reads no terms.
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'

import type { z } from '@workspace/zod'

import { termsFileSchema } from '../schemas'

import { parseFile } from './parse-file'
import { TERMS_FILE } from './paths'
import type { Lines, Problem } from './problems'
import { readYaml } from './read-yaml'

export type Terms = z.infer<typeof termsFileSchema>

/** A term or a role of the terms file: its meaning, its synonyms, its name in storage. */
export type TermEntry = Terms['terms'][string]

export function loadTerms(root: string): { terms?: Terms; lines: Lines; problems: Problem[] } {
  if (!existsSync(join(root, TERMS_FILE))) {
    return { lines: {}, problems: [] }
  }

  const read = readYaml(root, TERMS_FILE)

  if (read.problems.length > 0) {
    return { lines: read.lines, problems: read.problems }
  }

  const parsed = parseFile(TERMS_FILE, termsFileSchema, read.value)

  return parsed.value === undefined
    ? { lines: read.lines, problems: parsed.problems }
    : { terms: parsed.value, lines: read.lines, problems: [] }
}
