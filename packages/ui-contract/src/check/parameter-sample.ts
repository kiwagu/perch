/**
 * A value a route parameter's schema accepts, for a link that must carry one: its first
 * example, else its default, else its first enum value, else one built within its bounds,
 * the first of them Ajv accepts against the parameter's own schema. A string is built within
 * `minLength` and `maxLength` and a `pattern` of an optional literal prefix and at most one
 * character class repeated (`^draft$`, `^[a-z]+$`, `^\d{3}$`, `^thg_[a-z0-9]+$`, anchors
 * optional); a number within `minimum` and `maximum`, whole for an integer; a boolean is
 * true. A value for a path segment is never empty: its strings are one character long at
 * least, and an empty example, default or enum value is passed over. A parameter none of
 * whose values can be built has no sample: it needs an example.
 */

import { type Binding, createValidator } from '../files'

type Parameter = NonNullable<Binding['params']>['properties'][string]

type Value = string | number | boolean

/** Where a sample goes: a path segment, which cannot be empty, or a search value, which can. */
export type SampleSlot = 'path' | 'search'

/**
 * A number within a parameter's `minimum` and `maximum`, whole for an `integer`: 0 when the
 * bounds hold it, else the bound nearest to 0. (A binding's flat schema has no exclusive
 * bounds: it refuses them.)
 */
function numberWithin(parameter: Parameter): number {
  const whole = parameter.type === 'integer'
  const lowest = parameter.minimum ?? Number.NEGATIVE_INFINITY
  const highest = parameter.maximum ?? Number.POSITIVE_INFINITY

  return Math.min(
    Math.max(0, whole ? Math.ceil(lowest) : lowest),
    whole ? Math.floor(highest) : highest,
  )
}

/**
 * A pattern a value can be built for: plain characters, then at most one character class
 * repeated (`\d`, `\w`, or a class that is not negated, by its first character) with its
 * quantifier and bounds, anchors optional.
 */
const DERIVABLE = /^\^?([\w-]*)(?:(?:\\([dw])|\[([^\]^\\])[^\]]*\])(\+|\*|\{(\d+)(,(\d*))?\}))?\$?$/

/** A character of each shorthand class. */
const SHORTHAND: Readonly<Record<string, string>> = { d: '0', w: 'a' }

/** The repetitions a quantifier allows: `+`, `*`, `{n}`, `{n,}` or `{n,m}`. */
function repetitions(quantifier: string, fewest = '0', range?: string, most = ''): number[] {
  if (quantifier === '+') {
    return [1, Number.POSITIVE_INFINITY]
  }

  if (range === undefined) {
    return quantifier === '*' ? [0, Number.POSITIVE_INFINITY] : [Number(fewest), Number(fewest)]
  }

  return [Number(fewest), most === '' ? Number.POSITIVE_INFINITY : Number(most)]
}

/**
 * The fewest characters a string takes in `slot`: the parameter's `minLength`, 1 when it has
 * none, and never fewer than 1 in a path segment.
 */
const shortestIn = (parameter: Parameter, slot: SampleSlot): number =>
  slot === 'path' ? Math.max(1, parameter.minLength ?? 1) : (parameter.minLength ?? 1)

/**
 * The fewest repetitions within `[fewest, most]` after a prefix of `prefix` characters that
 * keep the whole within `shortest` and the parameter's `maxLength`.
 */
function countWithin(
  parameter: Parameter,
  shortest: number,
  prefix: number,
  fewest = 0,
  most = Number.POSITIVE_INFINITY,
): number {
  return Math.max(
    0,
    Math.min(
      Math.max(fewest, shortest - prefix),
      most,
      (parameter.maxLength ?? Number.POSITIVE_INFINITY) - prefix,
    ),
  )
}

/** A string of the parameter's lengths that its `pattern` accepts, when it is derivable. */
function stringOf(parameter: Parameter, slot: SampleSlot): string | undefined {
  const { pattern } = parameter
  const shortest = shortestIn(parameter, slot)

  if (pattern === undefined) {
    return 'a'.repeat(countWithin(parameter, shortest, 0))
  }

  const parts = DERIVABLE.exec(pattern)

  if (parts === null) {
    return undefined
  }

  const [, prefix = '', shorthand, first, quantifier, fewest, range, most] = parts
  const character = shorthand === undefined ? first : SHORTHAND[shorthand]

  if (quantifier === undefined) {
    return prefix
  }

  if (character === undefined) {
    return undefined
  }

  const [low, high] = repetitions(quantifier, fewest, range, most)

  return prefix + character.repeat(countWithin(parameter, shortest, prefix.length, low, high))
}

/** A value built from the parameter's type within its bounds, if one can be. */
function builtOf(parameter: Parameter, slot: SampleSlot): Value | undefined {
  const byType: Readonly<Record<Parameter['type'], () => Value | undefined>> = {
    string: () => stringOf(parameter, slot),
    integer: () => numberWithin(parameter),
    number: () => numberWithin(parameter),
    boolean: () => true,
  }

  return byType[parameter.type]()
}

/** Whether the parameter's own schema accepts a value; none when the schema does not compile. */
function acceptorOf(parameter: Parameter): ((value: Value) => boolean) | undefined {
  try {
    const validate = createValidator().compile(parameter)

    return (value) => validate(value)
  } catch {
    return undefined
  }
}

/**
 * The value of the parameter a link carries in `slot` when it must carry one, or none to be
 * built.
 */
export function parameterSample(parameter: Parameter, slot: SampleSlot): Value | undefined {
  const accepts = acceptorOf(parameter)

  if (accepts === undefined) {
    return undefined
  }

  const candidates = [
    parameter.examples?.[0],
    parameter.default,
    parameter.enum?.[0],
    builtOf(parameter, slot),
  ]

  return candidates.find(
    (value): value is Value =>
      value !== undefined && (slot === 'search' || value !== '') && accepts(value),
  )
}
