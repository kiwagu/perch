/** A change of one list of the contract, for the hand-over diff: what one side adds and removes. */

export interface Change {
  added: string[]
  removed: string[]
}

/** The order of every list of a change: by name, in English. */
export const byName = (a: string, b: string): number => a.localeCompare(b, 'en')

/** What `after` holds that `before` does not, and the other way round, each sorted by name. */
export function changeOf(before: readonly string[], after: readonly string[]): Change {
  const was = new Set(before)
  const is = new Set(after)

  return {
    added: [...is].filter((name) => !was.has(name)).sort(byName),
    removed: [...was].filter((name) => !is.has(name)).sort(byName),
  }
}
