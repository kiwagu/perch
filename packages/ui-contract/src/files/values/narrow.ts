/**
 * The keywords a parameter writes beside the value it refers to only narrow it: a `minLength` or
 * a `minimum` no smaller than the value's, a `maxLength` or a `maximum` no larger, an `enum` among
 * the value's members, a `type` or a `format` where the value has none or the same, and a
 * `pattern` where the value has none (whether one regular expression narrows another cannot be
 * told, and the same one again only repeats the value's rule). A keyword that would widen the
 * value, or say other than it says, does not narrow it: the contract check refuses it
 * (`wideningsOf`), and the value keeps its own (`narrowed`).
 */

import { sameValue } from '../../records'

import { keywordsOf, type ResolvedValue } from './keywords'

/** The keywords a parameter may write beside its value, in the order a value lists them. */
export const NARROWING_KEYWORDS = [
  'type',
  'enum',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minimum',
  'maximum',
] as const

export type NarrowingKeyword = (typeof NARROWING_KEYWORDS)[number]

/** Whether `low` is at most `high`, either left out holding. */
const atMost = (low: number | undefined, high: number | undefined): boolean =>
  low === undefined || high === undefined || low <= high

/** Whether every member of `inner` is one of `outer`, either left out holding. */
const among = (
  inner: readonly (string | number)[] | undefined,
  outer: readonly (string | number)[] | undefined,
): boolean => inner === undefined || outer === undefined || inner.every((m) => outer.includes(m))

/** Whether the keyword `inline` writes narrows the one `referred` has. */
function narrows(keyword: NarrowingKeyword, referred: ResolvedValue, inline: ResolvedValue) {
  switch (keyword) {
    case 'minLength':
    case 'minimum':
      return atMost(referred[keyword], inline[keyword])
    case 'maxLength':
    case 'maximum':
      return atMost(inline[keyword], referred[keyword])
    case 'enum':
      return among(inline.enum, referred.enum)
    case 'pattern':
      return referred.pattern === undefined || inline.pattern === undefined
    default:
      return (
        referred[keyword] === undefined ||
        inline[keyword] === undefined ||
        sameValue(inline[keyword], referred[keyword])
      )
  }
}

/** The keywords written beside `referred` (`inline`) that do not narrow it, in their order. */
export const wideningsOf = (referred: ResolvedValue, inline: ResolvedValue): NarrowingKeyword[] =>
  NARROWING_KEYWORDS.filter((keyword) => !narrows(keyword, referred, inline))

/** `referred` narrowed by `inline`: each keyword that narrows it in its place, no other. */
export function narrowed(referred: ResolvedValue, inline: ResolvedValue): ResolvedValue {
  const widenings = wideningsOf(referred, inline)
  const pick = <K extends NarrowingKeyword>(keyword: K): ResolvedValue[K] =>
    widenings.includes(keyword) ? referred[keyword] : (inline[keyword] ?? referred[keyword])

  return keywordsOf({
    ...referred,
    type: pick('type'),
    enum: pick('enum'),
    minLength: pick('minLength'),
    maxLength: pick('maxLength'),
    pattern: pick('pattern'),
    format: pick('format'),
    minimum: pick('minimum'),
    maximum: pick('maximum'),
  })
}
