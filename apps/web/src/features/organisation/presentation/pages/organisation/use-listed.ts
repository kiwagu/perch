import type { ResultAsync } from 'neverthrow'
import { useEffect, useRef, useState } from 'react'

import type { BusError } from '@workspace/cqrs'

/** A list as last read, and the code the latest read failed with. */
export interface Listed<Item> {
  readonly list: readonly Item[] | undefined
  readonly failure: string | undefined
  /**
   * The count of changes the latest settled read was made after, a failed read included: a
   * change counted higher is one whose read is not in yet. None before the first read settles.
   */
  readonly settled: number | undefined
}

/** A read of the list of one scope: what it was for, with what it read or why it failed. */
interface Read<Item> extends Listed<Item> {
  readonly scope: string
}

/**
 * The list of one scope (an organisation's key, an account), none to read while `scope` is
 * undefined: read when it starts to show and again whenever `changed` counts another read its
 * screen's flow asked for. A read that fails keeps the list read before it.
 */
export function useListed<Item>(
  read: (scope: string) => ResultAsync<readonly Item[], BusError>,
  scope: string | undefined,
  changed: number,
): Listed<Item> {
  const [last, setLast] = useState<Read<Item> | undefined>(undefined)
  // The latest read is called when the effect runs, so a render that makes a new one reads nothing.
  const reading = useRef(read)

  reading.current = read

  useEffect(() => {
    if (scope === undefined) {
      return undefined
    }

    let live = true

    void reading.current(scope).match(
      (list) => {
        if (live) {
          setLast({ scope, list, failure: undefined, settled: changed })
        }
      },
      (failure) => {
        if (live) {
          setLast((now) => ({
            scope,
            list: now?.scope === scope ? now.list : undefined,
            failure: failure.code,
            settled: changed,
          }))
        }
      },
    )

    return () => {
      live = false
    }
  }, [scope, changed])

  return last !== undefined && last.scope === scope
    ? last
    : { list: undefined, failure: undefined, settled: undefined }
}
