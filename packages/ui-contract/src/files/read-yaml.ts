/**
 * YAML through the `yaml` package with its defaults (YAML 1.2, unique keys): the data, or
 * why the package refused the text and the line it names.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { parse, YAMLParseError } from 'yaml'

import type { Problem } from './problems'

/** Why YAML refused the text, without the position it appends: the caller carries that. */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split('\n', 1)[0]
    ?.replace(/ at line \d+, column \d+:?$/, '') ?? ''

/** The data of `text`, or the reason it is not YAML with its line in `text` (1-based). */
export function parseYaml(text: string): { value: unknown } | { reason: string; line?: number } {
  try {
    return { value: parse(text) as unknown }
  } catch (error) {
    const line = error instanceof YAMLParseError ? error.linePos?.[0].line : undefined

    return line === undefined ? { reason: reasonOf(error) } : { reason: reasonOf(error), line }
  }
}

/** Reads a YAML contract file; a missing file or broken YAML is the one problem. */
export function readYaml(root: string, file: string): { value?: unknown; problems: Problem[] } {
  let text: string

  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch {
    return { problems: [{ file, message: 'cannot read the file' }] }
  }

  const parsed = parseYaml(text)

  if ('value' in parsed) {
    return { value: parsed.value, problems: [] }
  }

  const message = `not YAML: ${parsed.reason}`

  return {
    problems: [
      parsed.line === undefined ? { file, message } : { file, line: parsed.line, message },
    ],
  }
}
