/**
 * The keywords of a value, or of a parameter of a platform action, for the hand-over diff: each
 * keyword it writes, in the order a value lists them, its value written as JSON (`maxLength 254`,
 * `format "email"`, `enum ["a","b"]`), so values that differ never print alike: a string and a
 * number, one member with a comma and two. Its description is left out, as every description is:
 * the descriptions are a list of their own.
 */

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

/** Each keyword `value` writes, but those `skipped`, with its word, in the order of a value. */
export function valueWords(
  value: Readonly<Partial<Record<ValueKeyword, unknown>>>,
  skipped: readonly ValueKeyword[] = [],
): Map<ValueKeyword, string> {
  return new Map(
    VALUE_KEYWORDS.flatMap((keyword) =>
      value[keyword] === undefined || skipped.includes(keyword)
        ? []
        : [[keyword, wordOf(value[keyword])] as const],
    ),
  )
}
