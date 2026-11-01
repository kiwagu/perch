/**
 * Derived anchors: `<base>.<suffix>`, an element a composite renders for its base anchor
 * (`user.profile.sign-out-dialog.confirm-button`). Code builds one only with `testIdFor`,
 * so a text search for the base finds every element derived from it.
 */

export const testIdFor = (base: string, suffix: string): string => `${base}.${suffix}`

/** The base of a derived anchor: everything before the last segment, when that segment is a suffix. */
export const baseOf = (anchor: string, suffixes: readonly string[]): string | undefined => {
  const dot = anchor.lastIndexOf('.')

  return dot !== -1 && suffixes.includes(anchor.slice(dot + 1)) ? anchor.slice(0, dot) : undefined
}

/** A declared anchor, or a declared base followed by one of the suffixes. */
export const isKnownAnchor = (
  anchor: string,
  declared: ReadonlySet<string>,
  suffixes: readonly string[],
): boolean => {
  if (declared.has(anchor)) {
    return true
  }

  const base = baseOf(anchor, suffixes)

  return base !== undefined && declared.has(base)
}
