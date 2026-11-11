/**
 * The list a screen reads from the platform (a `source: { platform: <action> }` of the contract):
 * read when it starts to show, again whenever its screen's flow reads it (`read: <list>`), and
 * again whenever the organisation or account it is read for (its scope) or a search parameter its
 * source takes becomes another (`searchKeysOf`: the `{ search }` of its params, then `page` and
 * `size` when it pages). It shows nothing of an earlier scope or search once that is another, and
 * a read still in flight when what it reads for becomes another is dropped: its answer is shown
 * nowhere.
 */

import type { ResultAsync } from 'neverthrow'
import { useEffect, useRef, useState } from 'react'

import { type SearchedSource, searchKeysOf } from '@workspace/ui-contract/anchors'

/** A list as last read, and the code the latest read failed with. */
export interface Listed<List, Code extends string = string> {
  readonly list: List | undefined
  readonly failure: Code | undefined
  /**
   * The count of changes the latest settled read was made after, a failed read included: a
   * change counted higher is one whose read is not in yet. None before the first read settles.
   */
  readonly settled: number | undefined
}

/** The route's search a list reads with: its source, whose search keys scope it, and the search. */
export interface ListSearch {
  readonly source: SearchedSource
  readonly search: Readonly<Record<string, unknown>>
}

/** A read of the list of one scope and search: what it was for, with what it read or why it failed. */
interface Read<List, Code extends string> extends Listed<List, Code> {
  readonly key: string
}

/** What a list is read for: its scope, then the value of each search key its source reads. */
const keyOf = (scope: string, searched: ListSearch | undefined): string =>
  JSON.stringify([
    scope,
    ...(searched === undefined
      ? []
      : searchKeysOf(searched.source).map((name) => [name, searched.search[name] ?? null])),
  ])

/**
 * The list of one scope (an organisation's key, an account), none to read while `scope` is
 * undefined: read when it starts to show, again whenever `changed` counts another read its
 * screen's flow asked for, and again whenever a value of `searched`'s search that its source reads
 * becomes another. A read that fails keeps the list read before it for the same scope and search.
 */
export function useListed<List, Code extends string = string>(
  read: (scope: string) => ResultAsync<List, { readonly code: Code }>,
  scope: string | undefined,
  changed: number,
  searched?: ListSearch,
): Listed<List, Code> {
  const [last, setLast] = useState<Read<List, Code> | undefined>(undefined)
  // The latest read is called when the effect runs, so a render that makes a new one reads nothing.
  const reading = useRef(read)
  const key = scope === undefined ? undefined : keyOf(scope, searched)

  reading.current = read

  useEffect(() => {
    if (scope === undefined || key === undefined) {
      return undefined
    }

    let live = true

    void reading.current(scope).match(
      (list) => {
        if (live) {
          setLast({ key, list, failure: undefined, settled: changed })
        }
      },
      (failure) => {
        if (live) {
          setLast((now) => ({
            key,
            list: now?.key === key ? now.list : undefined,
            failure: failure.code,
            settled: changed,
          }))
        }
      },
    )

    return () => {
      live = false
    }
    // `key` stands for `scope` and the values of the search keys its source reads.
  }, [key, changed])

  return last !== undefined && last.key === key
    ? last
    : { list: undefined, failure: undefined, settled: undefined }
}
