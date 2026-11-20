/**
 * The edits of a block collection: a map's pairs or a sequence's items, each a unit of whole lines.
 * A kept unit is edited in place or, when that cannot be, written anew from where it starts; an
 * added one is inserted after the kept one before it, at the column of the first (an item after its
 * dash); a removed one is cut with its lines, the comment lines before it staying. Units kept out
 * of order, none left, or a unit that shares its line with its holder (the first pair of a map that
 * is an item) where it would be cut or preceded leave the collection to its holder.
 */

import { isNode, type Pair, type YAMLMap, type YAMLSeq } from 'yaml'

import { type Edit, type Edits, type NodeEdits, rangeOf, startOf } from './edit'
import { indented, lineEnd, lineStart, withoutLead, yamlOf } from './text'

/** A pair or an item with where it starts and the end of its last line. */
interface Unit {
  readonly start: number | undefined
  readonly end: number
  readonly value: unknown
}

/**
 * How a collection lays out its units (an item follows a dash), writes one, and edits a kept one
 * in place. A unit written anew in place of a kept one leaves out the comment and the blank line
 * before it, which the text keeps where they are.
 */
interface Layout {
  readonly dashed: boolean
  readonly textOf: (value: unknown, kept: boolean) => string
  readonly inPlace: (was: Unit, now: Unit) => Edits
}

const DASH = /^\s*-\s+$/

/** Whether the text before a unit on its line lets the unit's lines be cut or preceded alone. */
const alone = (lead: string, dashed: boolean): boolean =>
  dashed ? DASH.test(lead) : lead.trim() === ''

function blockEdits(
  source: string,
  before: readonly Unit[],
  after: readonly Unit[],
  { dashed, textOf, inPlace }: Layout,
): Edits {
  const first = before[0]?.start

  if (after.length === 0 || first === undefined) {
    return undefined
  }

  const lead = source.slice(lineStart(source, first), first)

  if (dashed && !DASH.test(lead)) {
    return undefined
  }

  const prefix = dashed ? lead.replace(/-\s+$/, '- ') : ' '.repeat(lead.length)
  const known = new Map(before.map((unit) => [unit.start, unit]))
  const kept = after.filter((unit) => known.has(unit.start))
  const keptStarts = new Set(kept.map((unit) => unit.start))
  const order = before.filter((unit) => keptStarts.has(unit.start))

  if (kept.some((unit, index) => unit.start !== order[index]?.start)) {
    return undefined
  }

  const edits: Edit[] = []
  let at = alone(lead, dashed) ? lineStart(source, first) : undefined

  for (const unit of after) {
    const was = known.get(unit.start)

    if (was === undefined) {
      if (at === undefined) {
        return undefined
      }

      const text = indented(textOf(unit.value, false), prefix.length)

      edits.push({ start: at, end: at, text: `${prefix}${text}\n` })
    } else {
      const start = was.start ?? 0
      const text = indented(textOf(unit.value, true), start - lineStart(source, start))

      edits.push(...(inPlace(was, unit) ?? [{ start, end: was.end, text: `${text}\n` }]))
      at = was.end
    }
  }

  for (const unit of before.filter(({ start }) => !keptStarts.has(start))) {
    const start = lineStart(source, unit.start ?? 0)

    if (!alone(source.slice(start, unit.start), dashed)) {
      return undefined
    }

    edits.push({ start, end: unit.end, text: '' })
  }

  return edits
}

function pairUnit(source: string, pair: Pair): Unit {
  const value = isNode(pair.value) && pair.value.range ? pair.value : undefined
  const start = startOf(pair.key)

  return {
    start,
    end: lineEnd(source, value === undefined ? (start ?? 0) : rangeOf(value)[2]),
    value: pair,
  }
}

export function blockMapEdits(
  source: string,
  was: YAMLMap,
  now: YAMLMap,
  nodeEdits: NodeEdits,
): Edits {
  const unit = (pair: Pair): Unit => pairUnit(source, pair)

  return blockEdits(source, was.items.map(unit), now.items.map(unit), {
    dashed: false,
    textOf: (value, kept) => {
      const pair = (value as Pair).clone()

      if (kept) {
        pair.key = withoutLead(pair.key)
      }

      return yamlOf(pair)
    },
    inPlace: (before, after) => {
      const old = before.value as Pair
      const next = after.value as Pair
      const key = nodeEdits(source, old.key, next.key, false)
      const value = nodeEdits(source, old.value, next.value, false)

      return key === undefined || value === undefined ? undefined : [...key, ...value]
    },
  })
}

export function blockSeqEdits(
  source: string,
  was: YAMLSeq,
  now: YAMLSeq,
  nodeEdits: NodeEdits,
): Edits {
  const unit = (item: unknown): Unit => ({
    start: startOf(item),
    end: isNode(item) && item.range ? lineEnd(source, item.range[2]) : 0,
    value: item,
  })

  return blockEdits(source, was.items.map(unit), now.items.map(unit), {
    dashed: true,
    textOf: (value, kept) => yamlOf(kept ? withoutLead(value) : value),
    inPlace: (before, after) => nodeEdits(source, before.value, after.value, false),
  })
}
