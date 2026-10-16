/**
 * Compiles one statement of the command dialect into replica operations. The
 * `.surql` statement stays the declaration of the command; on a client it never
 * runs as SurrealQL, it becomes a list of changes applied to the region document.
 *
 *   CREATE $id SET f = v, ...        create
 *   UPDATE $id SET f = v | f += v | f -= v, ...
 *   UPDATE $id UNSET f, ...
 *   DELETE $id
 *
 * Values are a declared parameter, a literal, NONE (removes the field) or
 * time::now(). Anything else needs a server function.
 */

import { type ParamDecl, type Region, recordTableOf } from '@workspace/data'
import type { ChangeSpec, ValueRef } from '@workspace/kernel'

import { ModelingException } from './errors'
import type { SchemaModel, TableModel } from './schema-structure'
import { isKeyword, isPunct, type Token, tokenize } from './tokenizer'

export interface CompiledCommand {
  readonly tables: readonly string[]
  readonly region: Region
  readonly ops: readonly ChangeSpec[]
}

const notCompilable = (detail: string): ModelingException =>
  new ModelingException(`${detail}: not compilable to replica ops; use a server function`)

type Value = ValueRef | 'none'

const ESCAPES: Readonly<Record<string, string>> = {
  n: '\n',
  r: '\r',
  t: '\t',
  '0': '\0',
  '\\': '\\',
  "'": "'",
  '"': '"',
}

/** The value of a quoted SurrealQL string; an escape the replica cannot reproduce is refused. */
function decodeString(quoted: string): string {
  return quoted.slice(1, -1).replace(/\\(.)/gs, (_match, escaped: string) => {
    const decoded = ESCAPES[escaped]

    if (decoded === undefined) {
      throw notCompilable(`the string escape \\${escaped} in ${quoted}`)
    }

    return decoded
  })
}

function literalValue(token: Token): unknown {
  if (token.kind === 'string') {
    return decodeString(token.text)
  }

  if (token.kind === 'number') {
    return Number(token.text)
  }

  return { TRUE: true, FALSE: false, NULL: null }[token.text.toUpperCase()]
}

function readValue(tokens: readonly Token[], params: readonly ParamDecl[]): Value {
  const [first, ...rest] = tokens
  const text = tokens.map((token) => token.text).join(' ')

  if (!first) {
    throw notCompilable('a missing value')
  }

  if (rest.length === 0) {
    if (first.kind === 'param') {
      if (!params.some((param) => param.name === first.text)) {
        throw new ModelingException(`undeclared parameter $${first.text}`)
      }

      return { param: first.text }
    }

    if (isKeyword(first, 'NONE')) {
      return 'none'
    }

    if (
      first.kind === 'string' ||
      first.kind === 'number' ||
      ['TRUE', 'FALSE', 'NULL'].includes(first.text.toUpperCase())
    ) {
      return { literal: literalValue(first) }
    }
  }

  if (/^time::now \( \)$/i.test(text)) {
    return { now: true }
  }

  throw notCompilable(`the value ${text}`)
}

/** Splits the tokens after SET on top-level commas. */
function assignments(tokens: readonly Token[]): Token[][] {
  const groups: Token[][] = [[]]
  let depth = 0

  for (const token of tokens) {
    depth += isPunct(token, '(') || isPunct(token, '[') || isPunct(token, '{') ? 1 : 0
    depth -= isPunct(token, ')') || isPunct(token, ']') || isPunct(token, '}') ? 1 : 0

    if (depth === 0 && isPunct(token, ',')) {
      groups.push([])
    } else {
      groups.at(-1)?.push(token)
    }
  }

  return groups.filter((group) => group.length > 0)
}

const CLAUSES = [
  'WHERE',
  'RETURN',
  'CONTENT',
  'MERGE',
  'PATCH',
  'REPLACE',
  'TIMEOUT',
  'PARALLEL',
  'ONLY',
]

export function compileCommand(
  header: { readonly name: string; readonly params: readonly ParamDecl[] },
  body: string,
  schema: SchemaModel,
): CompiledCommand {
  const tokens = tokenize(body).filter(
    (token, index, all) => !(isPunct(token, ';') && index === all.length - 1),
  )
  const [verb, target, ...rest] = tokens
  const kind = verb?.text.toUpperCase()

  if (!verb || !['CREATE', 'UPDATE', 'DELETE'].includes(kind ?? '')) {
    throw notCompilable(`${header.name}: ${verb?.text ?? 'an empty statement'}`)
  }

  const clause = rest.find((token) => CLAUSES.some((keyword) => isKeyword(token, keyword)))

  if (clause) {
    throw notCompilable(`${header.name}: the ${clause.text.toUpperCase()} clause`)
  }

  const recordParam = target?.kind === 'param' ? target.text : undefined
  const table = recordTableOf(header.params.find((param) => param.name === recordParam)?.type ?? '')

  if (!recordParam || !table) {
    throw new ModelingException(
      `${header.name}: the target of ${kind} must be a $parameter declared as record<table>`,
    )
  }

  const model = schema.tables[table]

  if (!model) {
    throw new ModelingException(`${header.name}: unknown table ${table}`)
  }

  if (model.replicate === 'none' || !model.region) {
    throw new ModelingException(
      `${header.name}: ${table} is server-only (@replicate none); commands compile to replica operations for replicated tables`,
    )
  }

  const ops =
    kind === 'DELETE'
      ? deleteOps(header.name, recordParam, rest)
      : writeOps(header, kind ?? '', recordParam, table, model, rest)

  return { tables: [table], region: model.region, ops }
}

function deleteOps(name: string, record: string, rest: readonly Token[]): ChangeSpec[] {
  if (rest.length > 0) {
    throw notCompilable(`${name}: text after DELETE $${record}`)
  }

  return [{ op: 'delete', record }]
}

function checkField(name: string, table: string, model: TableModel, field: string): void {
  if (!(field in model.fields)) {
    throw new ModelingException(`${name}: ${table} has no field ${field}`)
  }
}

function writeOps(
  header: { readonly name: string; readonly params: readonly ParamDecl[] },
  kind: string,
  record: string,
  table: string,
  model: TableModel,
  rest: readonly Token[],
): ChangeSpec[] {
  const [keyword, ...list] = rest

  if (kind === 'UPDATE' && isKeyword(keyword, 'UNSET')) {
    return assignments(list).map((group) => {
      const field = group[0]?.text ?? ''

      checkField(header.name, table, model, field)

      return { op: 'unset', record, field }
    })
  }

  if (!isKeyword(keyword, 'SET')) {
    throw notCompilable(`${header.name}: ${kind} without SET`)
  }

  const ops: ChangeSpec[] = []
  const created: Record<string, ValueRef> = {}

  for (const group of assignments(list)) {
    const [fieldToken, operator, ...valueTokens] = group
    const field = fieldToken?.text ?? ''
    const plus = isPunct(operator, '+') && isPunct(valueTokens[0], '=')
    const minus = isPunct(operator, '-') && isPunct(valueTokens[0], '=')
    const value = readValue(plus || minus ? valueTokens.slice(1) : valueTokens, header.params)
    const crdt = model.crdt?.[field]

    if (fieldToken?.kind !== 'word' || !(isPunct(operator, '=') || plus || minus)) {
      throw notCompilable(
        `${header.name}: the assignment ${group.map((token) => token.text).join(' ')}`,
      )
    }

    checkField(header.name, table, model, field)

    if (kind === 'CREATE') {
      if (plus || minus) {
        throw notCompilable(`${header.name}: ${field} ${plus ? '+=' : '-='} in a CREATE`)
      }

      if (value !== 'none') {
        created[field] = value
      }

      continue
    }

    if (plus || minus) {
      if (crdt !== 'list' || value === 'none') {
        throw notCompilable(
          `${header.name}: ${field} ${plus ? '+=' : '-='} needs a @crdt list field and a value`,
        )
      }

      ops.push({ op: plus ? 'list.push' : 'list.remove', record, field, value })
    } else if (value === 'none') {
      ops.push({ op: 'unset', record, field })
    } else if (crdt === 'text') {
      ops.push({ op: 'text.update', record, field, value })
    } else if (crdt === 'list' || crdt === 'counter') {
      throw new ModelingException(
        `${header.name}: ${field} is a @crdt ${crdt}; change it with += and -=`,
      )
    } else {
      ops.push({ op: 'set', record, field, value })
    }
  }

  return kind === 'CREATE' ? [{ op: 'create', record, fields: created }] : ops
}
