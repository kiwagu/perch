/**
 * The edits of one node against the node it was read as: a scalar's value written in place (left to
 * its holder when it would take more than its line, or had no text), a flow collection's parts
 * edited in place while they are the same parts (left to its holder otherwise), and a block
 * collection's units (`block.ts`). A node of another kind, or one the edit made, is left to its
 * holder.
 */

import { isDeepStrictEqual } from 'node:util'

import {
  isMap,
  isNode,
  isScalar,
  isSeq,
  type Pair,
  type Scalar,
  type YAMLMap,
  type YAMLSeq,
} from 'yaml'

import { blockMapEdits, blockSeqEdits } from './block'
import { type Edit, type Edits, rangeOf, startOf } from './edit'
import { flowYamlOf, yamlOf } from './text'

function scalarEdits(was: Scalar, now: Scalar, inFlow: boolean): Edits {
  if (now.value === was.value && now.type === was.type) {
    return []
  }

  const [start, end] = rangeOf(was)
  const bare = now.clone() as Scalar

  bare.comment = null
  bare.commentBefore = null
  bare.spaceBefore = false

  const text = inFlow ? flowYamlOf(bare) : yamlOf(bare)

  return start === end || text.includes('\n') ? undefined : [{ start, end, text }]
}

/** The keys and values of a map, the items of a sequence: what a flow collection holds, in order. */
const partsOf = (collection: YAMLMap | YAMLSeq): unknown[] =>
  isMap(collection)
    ? collection.items.flatMap((pair: Pair) => [pair.key, pair.value])
    : collection.items

function flowEdits(source: string, was: YAMLMap | YAMLSeq, now: YAMLMap | YAMLSeq): Edits {
  const before = partsOf(was)
  const after = partsOf(now)
  const edits: Edit[] = []

  if (before.length !== after.length) {
    return undefined
  }

  for (const [index, part] of before.entries()) {
    const found = nodeEdits(source, part, after[index], true)

    if (found === undefined) {
      return undefined
    }

    edits.push(...found)
  }

  return edits
}

/** The edits that write `now` in `source` where `was` was read, `now` being `was` as edited. */
export function nodeEdits(source: string, was: unknown, now: unknown, inFlow: boolean): Edits {
  if (!isNode(was)) {
    return isDeepStrictEqual(was, now) ? [] : undefined
  }

  if (!isNode(now) || startOf(now) !== startOf(was)) {
    return undefined
  }

  if (isScalar(was) && isScalar(now)) {
    return scalarEdits(was, now, inFlow)
  }

  if (isMap(was) && isMap(now) && Boolean(was.flow) === Boolean(now.flow)) {
    return inFlow || was.flow === true
      ? flowEdits(source, was, now)
      : blockMapEdits(source, was, now, nodeEdits)
  }

  if (isSeq(was) && isSeq(now) && Boolean(was.flow) === Boolean(now.flow)) {
    return inFlow || was.flow === true
      ? flowEdits(source, was, now)
      : blockSeqEdits(source, was, now, nodeEdits)
  }

  return undefined
}
