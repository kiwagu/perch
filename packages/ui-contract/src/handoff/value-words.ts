/**
 * The keywords of a value, of a parameter of a platform action or of a route's search parameter,
 * for the hand-over diff: each keyword it writes, in the order a value lists them, its value
 * written as JSON (`maxLength 254`, `format "email"`, `enum ["a","b"]`), so values that differ
 * never print alike: a string and a number, one member with a comma and two; and each keyword
 * that two of them write alike or not, as `<name> <keyword> <before> -> <after>`. Its
 * description is left out, as every description is: the descriptions are a list of their own.
 */

import { sameValue } from '../records'

export const VALUE_KEYWORDS = [
  'type',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
  'examples',
] as const

export type ValueKeyword = (typeof VALUE_KEYWORDS)[number]

/** A keyword's value as one word: its JSON, `none` where it has none. */
export const wordOf = (value: unknown): string =>
  value === undefined ? 'none' : JSON.stringify(value)

/** Each of `keywords` that `value` writes, but those `skipped`, with its word, in the order of `keywords`. */
export function keywordWords<Keyword extends string>(
  value: Readonly<Partial<Record<Keyword, unknown>>>,
  keywords: readonly Keyword[],
  skipped: readonly Keyword[] = [],
): Map<Keyword, string> {
  return new Map(
    keywords.flatMap((keyword) =>
      value[keyword] === undefined || skipped.includes(keyword)
        ? []
        : [[keyword, wordOf(value[keyword])] as const],
    ),
  )
}

/** Each keyword `value` writes, but those `skipped`, with its word, in the order of a value. */
export const valueWords = (
  value: Readonly<Partial<Record<ValueKeyword, unknown>>>,
  skipped: readonly ValueKeyword[] = [],
): Map<ValueKeyword, string> => keywordWords(value, VALUE_KEYWORDS, skipped)

/**
 * Each of `keywords` whose value differs between `was` and `is`, compared as data, as
 * `<name> <keyword> <before> -> <after>`, in the order of `keywords`.
 */
export const keywordChanges = <Keyword extends string>(
  name: string,
  keywords: readonly Keyword[],
  was: Readonly<Partial<Record<Keyword, unknown>>>,
  is: Readonly<Partial<Record<Keyword, unknown>>>,
): string[] =>
  keywords.flatMap((keyword) =>
    sameValue(was[keyword], is[keyword])
      ? []
      : [`${name} ${keyword} ${wordOf(was[keyword])} -> ${wordOf(is[keyword])}`],
  )
