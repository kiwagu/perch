/**
 * Derived anchors: `<base>.<suffix>`, an element a composite renders for its base anchor
 * (`user.profile.sign-out-dialog.confirm-button`), and the options of a paged list's size
 * select, two segments under the list (`<list>.size-select.option`). Code builds one only with
 * `testIdFor`, so a text search for the base finds every element derived from it. The app, the
 * tests and the checks tell a known anchor through `isKnownAnchor` and `isSizeOption` alike.
 */

import { SIZE_SELECT } from './paging'

export const testIdFor = (base: string, suffix: string): string => `${base}.${suffix}`

/** The derived `option` of a select, one per choice. */
const OPTION = 'option'

/** The base of a derived anchor: everything before the last segment, when that segment is a suffix. */
export const baseOf = (anchor: string, suffixes: readonly string[]): string | undefined => {
  const dot = anchor.lastIndexOf('.')

  return dot !== -1 && suffixes.includes(anchor.slice(dot + 1)) ? anchor.slice(0, dot) : undefined
}

/** The options of the size select of the paged list `list`: `<list>.size-select.option`. */
export const sizeOptionOf = (list: string): string =>
  testIdFor(testIdFor(list, SIZE_SELECT), OPTION)

/** Whether `anchor` names the size options of one of `paged`, the lists that page. */
export const isSizeOption = (anchor: string, paged: ReadonlySet<string>): boolean =>
  [...paged].some((list) => anchor === sizeOptionOf(list))

/**
 * A declared anchor, a declared base followed by one of the suffixes, or the size options of
 * one of the paged lists.
 */
export const isKnownAnchor = (
  anchor: string,
  declared: ReadonlySet<string>,
  suffixes: readonly string[],
  paged: ReadonlySet<string>,
): boolean => {
  if (declared.has(anchor) || isSizeOption(anchor, paged)) {
    return true
  }

  const base = baseOf(anchor, suffixes)

  return base !== undefined && declared.has(base)
}
