import type { ParamDecl } from '@workspace/data'

import { ModelingException } from './errors'
import { statementCount, tokenize } from './tokenizer'

export const ACTORS = ['record', 'guest', 'database', 'root'] as const

export type Actor = (typeof ACTORS)[number]

export interface ShapeHeader {
  readonly kind: 'shape'
  readonly params: readonly ParamDecl[]
  readonly tables?: readonly string[]
  /** The shape reads server-only tables and runs on a server, not on the replica. */
  readonly server: boolean
}

export interface CommandHeader {
  readonly kind: 'command'
  readonly name: string
  readonly params: readonly ParamDecl[]
  readonly allow: readonly Actor[]
  readonly deny: readonly Actor[]
  readonly tables?: readonly string[]
}

/** Session parameters SurrealDB provides itself; they need no declaration. */
const RESERVED_PARAMS = new Set([
  'auth',
  'session',
  'token',
  'access',
  'before',
  'after',
  'value',
  'this',
  'parent',
  'event',
  'input',
])

/** Splits on commas that are not nested inside `<>` or `()`. */
function splitTopLevel(list: string): string[] {
  const parts: string[] = []
  let depth = 0
  let current = ''

  for (const char of list) {
    if (char === '<' || char === '(') {
      depth++
    } else if (char === '>' || char === ')') {
      depth--
    }

    if (char === ',' && depth === 0) {
      parts.push(current)
      current = ''
    } else {
      current += char
    }
  }

  return [...parts, current].map((part) => part.trim()).filter(Boolean)
}

export function parseParams(list: string): ParamDecl[] {
  return splitTopLevel(list).map((part) => {
    const match = /^\$(\w+)\s*:\s*(.+)$/s.exec(part)

    if (!match?.[1] || !match[2]) {
      throw new ModelingException(`a parameter must read "$name: type", got "${part}"`)
    }

    return { name: match[1], type: match[2].trim() }
  })
}

const annotation = (text: string, name: string): string | undefined =>
  new RegExp(`^--\\s*@${name}\\b(.*)$`, 'm').exec(text)?.[1]?.trim()

function listAnnotation(text: string, name: string): string[] | undefined {
  const value = annotation(text, name)

  return value === undefined
    ? undefined
    : value
        .split(',')
        .map((item) => item.trim())
        .filter(Boolean)
}

function actorsOf(chunk: string, name: 'allow' | 'deny'): Actor[] {
  return [...chunk.matchAll(new RegExp(`^--\\s*@${name}\\s+(.*)$`, 'gm'))]
    .flatMap((match) => (match[1] ?? '').split(','))
    .map((actor) => actor.trim())
    .filter(Boolean)
    .map((actor) => {
      if (!(ACTORS as readonly string[]).includes(actor)) {
        throw new ModelingException(`unknown actor ${actor}; use one of ${ACTORS.join(', ')}`)
      }

      return actor as Actor
    })
}

const withoutComments = (text: string): string =>
  text
    .split('\n')
    .filter((line) => !line.trim().startsWith('--'))
    .join('\n')

function assertDeclared(body: string, params: readonly ParamDecl[]): void {
  for (const token of tokenize(body)) {
    if (
      token.kind === 'param' &&
      !RESERVED_PARAMS.has(token.text) &&
      !params.some((p) => p.name === token.text)
    ) {
      throw new ModelingException(`undeclared parameter $${token.text}`)
    }
  }
}

function assertSingleStatement(body: string): void {
  if (statementCount(tokenize(body)) !== 1) {
    throw new ModelingException('a shape or command must be a single statement')
  }
}

/** Reads a `*.shape.surql` file: the header annotations and the one SELECT. */
export function parseShapeFile(text: string): { header: ShapeHeader; body: string } {
  const paramsLine = annotation(text, 'params')
  const params = paramsLine ? parseParams(paramsLine) : []
  const tables = listAnnotation(text, 'tables')
  const body = withoutComments(text)

  assertDeclared(body, params)
  assertSingleStatement(body)

  return {
    header: {
      kind: 'shape',
      params,
      ...(tables ? { tables } : {}),
      server: annotation(text, 'server') !== undefined,
    },
    body,
  }
}

/** Reads a `*.commands.surql` file: one statement per `@command` header. */
export function parseCommandsFile(text: string): Array<{ header: CommandHeader; body: string }> {
  const chunks = text.split(/^(?=--\s*@command\b)/m)
  const preamble =
    chunks[0] !== undefined && !/^--\s*@command\b/.test(chunks[0]) ? chunks.shift() : undefined

  if (preamble !== undefined && withoutComments(preamble).trim() !== '') {
    throw new ModelingException(
      'every statement in a commands file needs an @command header above it',
    )
  }

  return chunks.map((chunk) => {
    const match = /^--\s*@command\s+(\w+)\s*\((.*)\)\s*$/m.exec(chunk)

    if (!match?.[1]) {
      throw new ModelingException(
        'an @command header must read "-- @command name($param: type, ...)"',
      )
    }

    const params = parseParams(match[2] ?? '')
    const tables = listAnnotation(chunk, 'tables')
    const body = withoutComments(chunk)

    assertDeclared(body, params)
    assertSingleStatement(body)

    return {
      header: {
        kind: 'command',
        name: match[1],
        params,
        allow: actorsOf(chunk, 'allow'),
        deny: actorsOf(chunk, 'deny'),
        ...(tables ? { tables } : {}),
      },
      body,
    }
  })
}
