/** Reading a machine config, or a flow, as plain records: what XState, the contract and its files give. */

export const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

export const recordOf = (value: unknown): Readonly<Record<string, unknown>> =>
  isRecord(value) ? value : {}

export const entriesOf = (value: unknown): [string, unknown][] =>
  isRecord(value) ? Object.entries(value) : []

/** One transition or a list of them, as a list; a string is a target alone. */
export function listOf(value: unknown): readonly unknown[] {
  if (value === undefined) {
    return []
  }

  return Array.isArray(value) ? value.map((each: unknown) => each) : [value]
}

/** Whether two values read from a config are the same: records by their keys, lists in order. */
export function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((each: unknown, index) => sameValue(each, b[index]))
    )
  }

  if (isRecord(a) && isRecord(b)) {
    const keys = Object.keys(a).filter((key) => a[key] !== undefined)

    return (
      keys.length === Object.keys(b).filter((key) => b[key] !== undefined).length &&
      keys.every((key) => sameValue(a[key], b[key]))
    )
  }

  return Object.is(a, b)
}
