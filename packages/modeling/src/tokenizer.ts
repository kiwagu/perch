import { ModelingException } from './errors'

export type TokenKind = 'word' | 'param' | 'string' | 'number' | 'punct'

export interface Token {
  readonly kind: TokenKind
  readonly text: string
  readonly start: number
  readonly end: number
}

const PUNCTUATION = ['<->', '->', '<-', '!=', '==', '<=', '>=', '..', '??', '?:', '::']

const isWordStart = (char: string): boolean => /[A-Za-z_]/.test(char)

const isWordPart = (char: string): boolean => /[A-Za-z0-9_]/.test(char)

function skipComment(source: string, index: number): number {
  const rest = source.slice(index, index + 2)

  if (rest === '--' || rest === '//' || source[index] === '#') {
    const newline = source.indexOf('\n', index)

    return newline === -1 ? source.length : newline + 1
  }

  if (rest === '/*') {
    const close = source.indexOf('*/', index + 2)

    return close === -1 ? source.length : close + 2
  }

  return index
}

function readQuoted(source: string, index: number, quote: string): number {
  let cursor = index + 1

  while (cursor < source.length && source[cursor] !== quote) {
    cursor += source[cursor] === '\\' ? 2 : 1
  }

  if (cursor >= source.length) {
    throw new ModelingException(`unterminated string starting at offset ${index}`)
  }

  return cursor + 1
}

/** Splits SurrealQL into tokens; enough to read the shape and command dialects, not a full grammar. */
export function tokenize(source: string): Token[] {
  const tokens: Token[] = []
  let index = 0

  while (index < source.length) {
    const char = source[index] ?? ''

    if (/\s/.test(char)) {
      index++

      continue
    }

    const afterComment = skipComment(source, index)

    if (afterComment !== index) {
      index = afterComment

      continue
    }

    const start = index

    if (char === "'" || char === '"' || char === '⟨') {
      index = char === '⟨' ? source.indexOf('⟩', index) + 1 : readQuoted(source, index, char)
      tokens.push({ kind: 'string', text: source.slice(start, index), start, end: index })

      continue
    }

    if (
      isWordStart(char) &&
      (source[index + 1] === "'" || source[index + 1] === '"') &&
      /[rdub]/.test(char)
    ) {
      index = readQuoted(source, index + 1, source[index + 1] ?? "'")
      tokens.push({ kind: 'string', text: source.slice(start, index), start, end: index })

      continue
    }

    if (char === '$') {
      index++

      while (index < source.length && isWordPart(source[index] ?? '')) {
        index++
      }

      tokens.push({ kind: 'param', text: source.slice(start + 1, index), start, end: index })

      continue
    }

    if (/[0-9]/.test(char)) {
      while (index < source.length && /[0-9A-Za-z_.]/.test(source[index] ?? '')) {
        index++
      }

      tokens.push({ kind: 'number', text: source.slice(start, index), start, end: index })

      continue
    }

    if (isWordStart(char)) {
      while (
        index < source.length &&
        (isWordPart(source[index] ?? '') ||
          (source.startsWith('::', index) && isWordStart(source[index + 2] ?? '')))
      ) {
        index += source.startsWith('::', index) ? 2 : 1
      }

      tokens.push({ kind: 'word', text: source.slice(start, index), start, end: index })

      continue
    }

    const punct = PUNCTUATION.find((candidate) => source.startsWith(candidate, index)) ?? char

    index += punct.length
    tokens.push({ kind: 'punct', text: punct, start, end: index })
  }

  return tokens
}

/** Number of non-empty statements separated by `;`. */
export function statementCount(tokens: readonly Token[]): number {
  let count = 0
  let pending = false

  for (const token of tokens) {
    if (token.kind === 'punct' && token.text === ';') {
      count += pending ? 1 : 0
      pending = false
    } else {
      pending = true
    }
  }

  return count + (pending ? 1 : 0)
}

export const isKeyword = (token: Token | undefined, keyword: string): boolean =>
  token?.kind === 'word' && token.text.toUpperCase() === keyword

export const isPunct = (token: Token | undefined, text: string): boolean =>
  token?.kind === 'punct' && token.text === text
