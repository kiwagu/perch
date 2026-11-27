/**
 * The values the probes of the platform's parameters are built from: for a value the contract
 * declares, a text of any length the value takes but for its length, one that breaks its pattern
 * or its format, and the bounds a value states, each as the value just inside it and just past it.
 */

/** The constraints of a value the probes read. */
export interface ValueBounds {
  readonly minLength?: number | undefined
  readonly maxLength?: number | undefined
  readonly pattern?: string | undefined
  readonly format?: string | undefined
}

/** A bound of a value: what it limits, and the two values on either side of it. */
export interface Bound {
  readonly name: string
  /** The value just inside the bound; undefined where a valid value of the parameter is it. */
  readonly inside: string | undefined
  /** The value just past the bound. */
  readonly past: string
  /** The one constraint of the value this bound is, as `FIELD_CODE_SUFFIXES` reads it. */
  readonly constraint: {
    readonly minLength?: number
    readonly maxLength?: number
    readonly pattern?: string
    readonly format?: string
  }
}

/** The values whose instances the gateway issues: no text of a bound's length names one. */
const ISSUED = new Set(['id'])

/** Whether the gateway issues the instances of the value named `ref`. */
export const isIssued = (ref: string): boolean => ISSUED.has(ref)

/**
 * The values a request checks against what the account holds: a text past their bounds is a wrong
 * one, so it answers as a wrong text inside them does.
 */
const CHECKED = new Set(['password'])

/** Whether a text of the value named `ref` past its bounds is refused as a wrong one. */
export const isChecked = (ref: string): boolean => CHECKED.has(ref)

/** The part of an address that is longest in a domain: labels of at most 63 characters. */
const LABEL = 63

/** The longest local part of an address the database takes. */
const LOCAL = 64

/**
 * An address of `length` characters, as the gateway and the database take it: a local part of
 * at most 64 characters, then labels of at most 63, the last one `test`.
 */
function emailOfLength(length: number): string {
  const local = 'a'.repeat(Math.min(LOCAL, length - 16))
  let rest = length - local.length - 1 - 'test'.length
  let labels = ''

  // A label with its dot takes 2 characters at least and 64 at most.
  while (rest > 0) {
    const take = rest >= LABEL + 3 ? LABEL + 1 : rest > LABEL + 1 ? rest - 2 : rest

    labels += `${'b'.repeat(take - 1)}.`
    rest -= take
  }

  const email = `${local}@${labels}test`

  if (email.length !== length) {
    throw new Error(`no address of ${length} characters: built one of ${email.length}`)
  }

  return email
}

/** A new password of `length` characters that keeps the rules of one but for its length. */
export const passwordOfLength = (length: number): string => `Aa1!${'x'.repeat(length - 4)}`

/** The text of `length` characters a value takes but for its length, by the value's name. */
const FITTED: Readonly<Record<string, (length: number) => string>> = {
  email: emailOfLength,
  'new-password': passwordOfLength,
}

/** A text that breaks the pattern or the format of a value, by the value's name. */
const BROKEN: Readonly<Record<string, string>> = {
  email: 'not-an-email',
  'new-password': 'Aa1! xxxxxx',
  'organisation-key': 'Not-a-key',
}

const plain = (length: number): string => 'a'.repeat(length)

const fitted = (ref: string, length: number): string => (FITTED[ref] ?? plain)(length)

function broken(ref: string, keyword: 'pattern' | 'format'): string {
  const text = BROKEN[ref]

  if (text === undefined) {
    throw new Error(`no text breaks the ${keyword} of the value ${ref}: name one in BROKEN`)
  }

  return text
}

/** The bounds the value named `ref` states: its lengths, its pattern and its format. */
export function boundsOf(ref: string, value: ValueBounds): readonly Bound[] {
  const bounds: Bound[] = []
  const { minLength, maxLength, pattern, format } = value

  if (maxLength !== undefined) {
    bounds.push({
      name: `maxLength ${maxLength}`,
      inside: fitted(ref, maxLength),
      past: fitted(ref, maxLength + 1),
      constraint: { maxLength },
    })
  }

  if (minLength !== undefined && minLength >= 1) {
    bounds.push({
      name: `minLength ${minLength}`,
      inside: fitted(ref, minLength),
      past: fitted(ref, minLength - 1),
      constraint: { minLength },
    })
  }

  if (pattern !== undefined) {
    bounds.push({
      name: 'pattern',
      inside: undefined,
      past: broken(ref, 'pattern'),
      constraint: { pattern },
    })
  }

  if (format !== undefined) {
    bounds.push({
      name: `format ${format}`,
      inside: undefined,
      past: broken(ref, 'format'),
      constraint: { format },
    })
  }

  return bounds
}
