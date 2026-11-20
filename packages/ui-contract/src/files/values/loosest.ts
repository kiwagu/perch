/**
 * The loosest of several values: what every one of them accepts, a field that passes them all
 * accepts. `minLength` and `minimum` are the smallest, `maxLength` and `maximum` the largest, each
 * kept only when every value has one; `type`, `pattern`, `format` and `enum` are kept only when
 * every value has the same; `readOnly` only when every value has it. No value gives no constraint.
 */

import { sameValue } from '../../records'

import { keywordsOf, type ResolvedValue } from './keywords'

type Bound = 'minLength' | 'maxLength' | 'minimum' | 'maximum'

/** The bound `key` of every value by `pick`, or undefined when one value lacks it. */
function boundOf(
  values: readonly ResolvedValue[],
  key: Bound,
  pick: (...bounds: number[]) => number,
): number | undefined {
  const bounds = values.map((value) => value[key])

  return bounds.length > 0 && bounds.every((bound): bound is number => bound !== undefined)
    ? pick(...bounds)
    : undefined
}

/** The keyword `key` every value writes the same, or undefined when one differs or lacks it. */
function sharedOf<K extends 'type' | 'pattern' | 'format' | 'enum' | 'readOnly'>(
  values: readonly ResolvedValue[],
  key: K,
): ResolvedValue[K] | undefined {
  const [first, ...others] = values
  const shared = first?.[key]

  return shared !== undefined && others.every((value) => sameValue(value[key], shared))
    ? shared
    : undefined
}

export function loosest(values: readonly ResolvedValue[]): ResolvedValue {
  return keywordsOf({
    type: sharedOf(values, 'type'),
    enum: sharedOf(values, 'enum'),
    minLength: boundOf(values, 'minLength', Math.min),
    maxLength: boundOf(values, 'maxLength', Math.max),
    pattern: sharedOf(values, 'pattern'),
    format: sharedOf(values, 'format'),
    minimum: boundOf(values, 'minimum', Math.min),
    maximum: boundOf(values, 'maximum', Math.max),
    readOnly: sharedOf(values, 'readOnly'),
  })
}
