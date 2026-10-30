/**
 * A module's id: the `id` of the object literal its `*.module.ts` manifest passes to
 * `defineModule`, or the folder name when the folder has no manifest. The id is read by a
 * scan that steps over comments and strings and ignores nested objects.
 */

import { readdirSync, readFileSync } from 'node:fs'
import { basename, join } from 'node:path'

const IDENTIFIER_CHAR = /[A-Za-z0-9_$]/

/** The index just past the string literal that starts at `start` (escapes honoured). */
function endOfString(source: string, start: number): number {
  const quote = source[start]
  let i = start + 1

  while (i < source.length) {
    if (source[i] === '\\') {
      i += 2
      continue
    }

    if (source[i] === quote) {
      return i + 1
    }

    i += 1
  }

  return source.length
}

/** The index past the comment or string literal that starts at `i`, or `i` when code starts there. */
function skipNonCode(source: string, i: number): number {
  const two = source.slice(i, i + 2)

  if (two === '//') {
    const end = source.indexOf('\n', i)

    return end === -1 ? source.length : end
  }

  if (two === '/*') {
    const end = source.indexOf('*/', i + 2)

    return end === -1 ? source.length : end + 2
  }

  const quote = source[i]

  if (quote === "'" || quote === '"' || quote === '`') {
    return endOfString(source, i)
  }

  return i
}

/** The last code character before `i`, skipping whitespace. */
function codeCharBefore(source: string, i: number): string {
  let j = i - 1

  while (j >= 0 && /\s/.test(source[j] ?? '')) {
    j -= 1
  }

  return source[j] ?? ''
}

/** The string value of the property `id: '<value>'` whose key starts at `i`, or undefined. */
function stringValueAt(source: string, i: number): string | undefined {
  const rest = /^id\s*:\s*/.exec(source.slice(i))

  if (rest === null) {
    return undefined
  }

  const valueStart = i + rest[0].length
  const quote = source[valueStart]

  if (quote !== "'" && quote !== '"' && quote !== '`') {
    return undefined
  }

  const valueEnd = endOfString(source, valueStart)
  const value = source.slice(valueStart + 1, valueEnd - 1)

  return quote === '`' && value.includes('${') ? undefined : value
}

/**
 * The `id` of the object literal passed to `defineModule(...)`: a scan over the source that
 * steps over comments and strings, finds the call itself (not the name in an import), and reads only a property of the literal's
 * own top level, so an `id` of a nested object, of another object before the call, or inside
 * a comment or a string is never taken. Undefined when the manifest has no such property or
 * its value is not a plain string.
 */
function readModuleId(source: string): string | undefined {
  let i = 0
  let depth = -1

  while (i < source.length) {
    const next = skipNonCode(source, i)

    if (next !== i) {
      i = next
      continue
    }

    const ch = source[i] ?? ''

    if (depth === -1) {
      const call = /^defineModule\s*\(\s*\{/.exec(source.slice(i))

      if (call !== null && !IDENTIFIER_CHAR.test(source[i - 1] ?? '')) {
        depth = 1
        i += call[0].length
        continue
      }

      i += 1
      continue
    }

    if (ch === '{' || ch === '(' || ch === '[') {
      depth += 1
    } else if (ch === '}' || ch === ')' || ch === ']') {
      depth -= 1

      if (depth === 0) {
        return undefined
      }
    } else if (
      depth === 1 &&
      source.startsWith('id', i) &&
      !IDENTIFIER_CHAR.test(source[i - 1] ?? '') &&
      ['{', ','].includes(codeCharBefore(source, i))
    ) {
      const value = stringValueAt(source, i)

      if (value !== undefined) {
        return value
      }
    }

    i += 1
  }

  return undefined
}

/** The module id: from the manifest when the folder has one, else the folder name. */
export function moduleIdOf(dir: string): { readonly id: string; readonly problem?: string } {
  const manifest = readdirSync(dir).find((name) => name.endsWith('.module.ts'))

  if (manifest === undefined) {
    return { id: basename(dir) }
  }

  const id = readModuleId(readFileSync(join(dir, manifest), 'utf8'))

  if (id === undefined) {
    return {
      id: basename(dir),
      problem: `${join(dir, manifest)}: the module id could not be read (expected defineModule({ id: '<name>', ... }))`,
    }
  }

  return { id }
}
