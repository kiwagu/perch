/** An edit of a YAML text, and where a node read from the text sits in it. */

import { isNode, type Node } from 'yaml'

/** Writes `text` in place of the text from `start` to `end`; an insertion when they are equal. */
export interface Edit {
  readonly start: number
  readonly end: number
  readonly text: string
}

/** The edits that write a node's change, or undefined when the unit holding it is written anew. */
export type Edits = readonly Edit[] | undefined

/** The edits that write `now` in `source` where `was` was read, `now` being `was` as edited. */
export type NodeEdits = (source: string, was: unknown, now: unknown, inFlow: boolean) => Edits

type Range = readonly [number, number, number]

/** The range of a node read from the text: its start, the end of its value and its own end. */
export function rangeOf(node: Node): Range {
  if (!node.range) {
    throw new Error('a node read from the text has no range')
  }

  return node.range
}

/** Where a node read from the text starts; none for a value the edit made. */
export const startOf = (value: unknown): number | undefined =>
  isNode(value) ? value.range?.[0] : undefined
