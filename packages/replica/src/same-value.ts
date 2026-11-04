const isList = (value: unknown): value is readonly unknown[] => Array.isArray(value)

const isObject = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/**
 * Whether two plain JSON values are the same, whatever the order of an object's keys: what
 * tells a record the batch changed from one it left as it was, field by field.
 */
export function sameValue(a: unknown, b: unknown): boolean {
  if (isList(a) || isList(b)) {
    return (
      isList(a) &&
      isList(b) &&
      a.length === b.length &&
      a.every((item, index) => sameValue(item, b[index]))
    )
  }

  if (isObject(a) && isObject(b)) {
    const keys = Object.keys(a)

    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameValue(a[key], b[key]))
    )
  }

  return Object.is(a, b)
}
