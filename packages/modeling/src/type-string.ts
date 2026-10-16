/** A field type of the schema, as the modeling stage reasons about it. */
export type ScalarName =
  | 'string'
  | 'int'
  | 'float'
  | 'bool'
  | 'datetime'
  | 'uuid'
  | 'decimal'
  | 'duration'
  | 'number'
  | 'bytes'
  | 'any'

export type FieldType =
  | { readonly kind: 'scalar'; readonly name: ScalarName }
  | { readonly kind: 'record'; readonly tables: readonly string[] }
  | { readonly kind: 'option'; readonly inner: FieldType }
  | { readonly kind: 'array'; readonly inner: FieldType }
  | { readonly kind: 'object'; readonly fields: Readonly<Record<string, FieldType>> }
  | { readonly kind: 'literal'; readonly values: readonly string[] }

const SCALARS: ReadonlySet<string> = new Set([
  'string',
  'int',
  'float',
  'bool',
  'datetime',
  'uuid',
  'decimal',
  'duration',
  'number',
  'bytes',
  'any',
])

const ANY: FieldType = { kind: 'scalar', name: 'any' }

/** Splits on a separator that is not nested inside `<>`, `()` or a quoted literal. */
export function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = []
  let depth = 0
  let quote: string | undefined
  let current = ''

  for (const char of text) {
    if (quote) {
      quote = char === quote ? undefined : quote
    } else if (char === "'" || char === '"') {
      quote = char
    } else if (char === '<' || char === '(') {
      depth++
    } else if (char === '>' || char === ')') {
      depth--
    }

    if (char === separator && depth === 0 && !quote) {
      parts.push(current.trim())
      current = ''
    } else {
      current += char
    }
  }

  return [...parts, current.trim()].filter(Boolean)
}

const literalOf = (part: string): string | undefined => /^(['"])(.*)\1$/s.exec(part)?.[2]

function parseSingle(part: string): FieldType {
  const literal = literalOf(part)

  if (literal !== undefined) {
    return { kind: 'literal', values: [literal] }
  }

  const generic = /^(\w+)<(.*)>$/s.exec(part)

  if (generic) {
    const [, name = '', inner = ''] = generic

    if (name === 'option') {
      return { kind: 'option', inner: parseTypeString(inner) }
    }

    if (name === 'array' || name === 'set') {
      return { kind: 'array', inner: parseTypeString(splitTopLevel(inner, ',')[0] ?? 'any') }
    }

    if (name === 'record') {
      return { kind: 'record', tables: splitTopLevel(inner, '|') }
    }

    return ANY
  }

  if (part === 'record') {
    return { kind: 'record', tables: [] }
  }

  if (part === 'object') {
    return { kind: 'object', fields: {} }
  }

  return SCALARS.has(part) ? { kind: 'scalar', name: part as ScalarName } : ANY
}

/** Parses a SurrealQL type as the database reports it, e.g. `none | string` or `array<record<identity>>`. */
export function parseTypeString(text: string): FieldType {
  const parts = splitTopLevel(text.trim(), '|')

  if (parts.length <= 1) {
    return parseSingle(parts[0] ?? 'any')
  }

  const rest = parts.filter((part) => part !== 'none' && part !== 'null')

  if (rest.length < parts.length) {
    return { kind: 'option', inner: parseTypeString(rest.join(' | ')) }
  }

  const literals = parts.map(literalOf)

  return literals.every((value) => value !== undefined)
    ? { kind: 'literal', values: literals as string[] }
    : ANY
}
