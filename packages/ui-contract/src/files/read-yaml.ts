/**
 * YAML through the `yaml` package with its defaults (YAML 1.2, unique keys): the data with
 * the line of each key and item, or why the package refused the text and the line it names.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { isMap, isNode, isScalar, isSeq, LineCounter, parseDocument, YAMLParseError } from 'yaml'

import { jsonPath, type Lines, type Problem } from './problems'

/** Why YAML refused the text, without the position it appends: the caller carries that. */
const reasonOf = (error: unknown): string =>
  (error instanceof Error ? error.message : String(error))
    .split('\n', 1)[0]
    ?.replace(/ at line \d+, column \d+:?$/, '') ?? ''

/** The reason the text is not YAML, with its line in the text (1-based) when YAML names one. */
function refusal(error: unknown): { reason: string; line?: number } {
  const line = error instanceof YAMLParseError ? error.linePos?.[0].line : undefined

  return line === undefined ? { reason: reasonOf(error) } : { reason: reasonOf(error), line }
}

/** The line of each key of a map and each item of a sequence in `node`, by its JSON path. */
function linesIn(
  node: unknown,
  at: readonly PropertyKey[],
  lineOf: (offset: number) => number,
): Array<[string, number]> {
  if (isMap(node)) {
    return node.items.flatMap(({ key, value }): Array<[string, number]> => {
      if (!isScalar(key) || !key.range) {
        return []
      }

      const path = [...at, String(key.value)]

      return [[jsonPath(path), lineOf(key.range[0])], ...linesIn(value, path, lineOf)]
    })
  }

  if (isSeq(node)) {
    return node.items.flatMap((item, index): Array<[string, number]> => {
      const path = [...at, index]
      const start = isNode(item) ? item.range?.[0] : undefined
      const own: Array<[string, number]> =
        start === undefined ? [] : [[jsonPath(path), lineOf(start)]]

      return [...own, ...linesIn(item, path, lineOf)]
    })
  }

  return []
}

/**
 * The data of `text` with the line of each key and item (1-based), or the reason it is not
 * YAML with its line in `text`. Warnings are emitted as the package's `parse` emits them.
 */
export function parseYaml(
  text: string,
): { value: unknown; lines: Lines } | { reason: string; line?: number } {
  const counter = new LineCounter()

  try {
    const document = parseDocument(text, { lineCounter: counter })
    const [error] = document.errors

    if (error !== undefined) {
      return refusal(error)
    }

    for (const warning of document.warnings) {
      process.emitWarning(warning)
    }

    const lineOf = (offset: number): number => counter.linePos(offset).line

    return {
      value: document.toJS() as unknown,
      lines: Object.fromEntries(linesIn(document.contents, [], lineOf)),
    }
  } catch (error) {
    return refusal(error)
  }
}

/** Reads a YAML contract file; a missing file or broken YAML is the one problem. */
export function readYaml(
  root: string,
  file: string,
): { value?: unknown; lines: Lines; problems: Problem[] } {
  let text: string

  try {
    text = readFileSync(join(root, file), 'utf8')
  } catch {
    return { lines: {}, problems: [{ file, message: 'cannot read the file' }] }
  }

  const parsed = parseYaml(text)

  if ('value' in parsed) {
    return { value: parsed.value, lines: parsed.lines, problems: [] }
  }

  const message = `not YAML: ${parsed.reason}`

  return {
    lines: {},
    problems: [
      parsed.line === undefined ? { file, message } : { file, line: parsed.line, message },
    ],
  }
}
