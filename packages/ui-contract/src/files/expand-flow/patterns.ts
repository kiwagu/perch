/**
 * A region written by its pattern, expanded into the region it stands for. A region without
 * `pattern` is left as it is; one with a pattern is parsed by the pattern's schema first, so a
 * mistake in it is named there, never as a mismatch of the region it would have become: the
 * region it becomes is complete, and nothing walks its states again.
 *
 * - `draft`: `following` on the event of `input` moves to `edited`; `edited` goes back to
 *   `following` on the event of `input` or on the data event `stored`, whenever `guard` holds.
 */

import type { z } from '@workspace/zod'

import { isRecord } from '../../records'
import { draftPatternSchema } from '../../schemas'

import type { Expansion } from './expansion'
import { parsed } from './parsed'

function draftOf(pattern: z.output<typeof draftPatternSchema>): unknown {
  const back = { target: 'following', guard: pattern.guard }

  return {
    ...(pattern.description === undefined ? {} : { description: pattern.description }),
    initial: 'following',
    states: {
      following: { on: { [pattern.input]: { target: 'edited' } } },
      edited: { on: { [pattern.input]: back, [pattern.stored]: { ...back } } },
    },
  }
}

/**
 * The region a pattern stands for, complete (`expanded`), or the region as it is: one without
 * a pattern, for the caller to walk, or one whose pattern is wrong, with its issues reported.
 */
export function patternOf(
  region: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): { region: unknown; expanded: boolean } {
  if (!isRecord(region) || region['pattern'] === undefined) {
    return { region, expanded: false }
  }

  if (region['pattern'] === 'draft') {
    const pattern = parsed(draftPatternSchema, region, expansion, at)

    return pattern === undefined
      ? { region, expanded: true }
      : { region: draftOf(pattern), expanded: true }
  }

  expansion.issues.push({
    at: [...at, 'pattern'],
    message: `"${String(region['pattern'])}" is not a region pattern: draft`,
  })

  return { region, expanded: true }
}
