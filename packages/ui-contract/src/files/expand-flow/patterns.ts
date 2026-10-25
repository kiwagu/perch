/**
 * A region written by its pattern, expanded into the region it stands for. A region without
 * `pattern` is left as it is; one with a pattern is parsed by the pattern's schema first, so a
 * mistake in it is named there, never as a mismatch of the region it would have become, and
 * the shorter forms inside it (the outcomes of `submit`) are expanded at their place in the
 * file: the region it becomes is complete, and nothing walks its states again.
 *
 * - `submit`: `idle` on the event `by` moves to the state `as`, which runs `src` with `input`;
 *   `onDone` and `onError` (absent: back to `idle`; a transition without a target goes back
 *   to `idle` too) are its outcomes.
 * - `draft`: `following` on the event of `input` moves to `edited`; `edited` goes back to
 *   `following` on the event of `input` or on the data event `stored`, whenever `guard` holds.
 */

import type { z } from '@workspace/zod'

import { isRecord } from '../../records'
import { draftPatternSchema, submitPatternSchema } from '../../schemas'
import { englishErrors } from '../parse-file'

import { transitionsOf } from './effects'
import type { Expansion } from './expansion'

const IDLE = 'idle'

/** A transition of `submit` that names no target goes back to `idle`; absent, so does it. */
function backToIdle(value: unknown): unknown {
  if (value === undefined) {
    return { target: IDLE }
  }

  const one = (each: unknown): unknown =>
    isRecord(each) && each['target'] === undefined ? { target: IDLE, ...each } : each

  return Array.isArray(value) ? value.map(one) : one(value)
}

function submitOf(
  pattern: z.output<typeof submitPatternSchema>,
  expansion: Expansion,
  at: readonly PropertyKey[],
): unknown {
  const outcome = (key: 'onDone' | 'onError'): unknown =>
    backToIdle(
      pattern[key] === undefined ? undefined : transitionsOf(pattern[key], expansion, [...at, key]),
    )

  return {
    ...(pattern.description === undefined ? {} : { description: pattern.description }),
    initial: IDLE,
    states: {
      [IDLE]: { on: { [pattern.by]: { target: pattern.as } } },
      [pattern.as]: {
        invoke: {
          src: pattern.src,
          ...(pattern.input === undefined ? {} : { input: pattern.input }),
          onDone: outcome('onDone'),
          onError: outcome('onError'),
        },
      },
    },
  }
}

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

/** `region` parsed by `schema`, or undefined with its issues reported. */
function parsed<S extends z.ZodType>(
  schema: S,
  region: unknown,
  expansion: Expansion,
  at: readonly PropertyKey[],
): z.output<S> | undefined {
  const result = schema.safeParse(region, { error: englishErrors })

  if (result.success) {
    return result.data
  }

  for (const issue of result.error.issues) {
    expansion.issues.push({ at: [...at, ...issue.path], message: issue.message })
  }

  return undefined
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

  if (region['pattern'] === 'submit') {
    const pattern = parsed(submitPatternSchema, region, expansion, at)

    return pattern === undefined
      ? { region, expanded: true }
      : { region: submitOf(pattern, expansion, at), expanded: true }
  }

  if (region['pattern'] === 'draft') {
    const pattern = parsed(draftPatternSchema, region, expansion, at)

    return pattern === undefined
      ? { region, expanded: true }
      : { region: draftOf(pattern), expanded: true }
  }

  expansion.issues.push({
    at: [...at, 'pattern'],
    message: `"${String(region['pattern'])}" is not a region pattern: submit or draft`,
  })

  return { region, expanded: true }
}
