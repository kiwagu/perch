import type { ResultAsync } from 'neverthrow'
import { useCallback, useEffect, useRef, useState } from 'react'

/** What a section of the page knows of what it reads: not yet, not at all, or the value read. */
export type SectionRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: T }

/**
 * Reads what a section shows when the page opens, and again each time `again` is called (the
 * flow's `read` of the section after an action). The value read stays on show while the next read
 * runs; one that fails leaves the section as unread, and a read that is no longer the latest, or
 * ends after the page has gone, says nothing.
 */
export function useSectionRead<T>(read: () => ResultAsync<T, unknown>): {
  readonly read: SectionRead<T>
  readonly again: () => void
} {
  const [result, setResult] = useState<SectionRead<T>>({ status: 'loading' })
  const [reads, setReads] = useState(0)
  // The read is taken when an effect runs, so a render that makes a new one reads nothing.
  const latest = useRef(read)

  latest.current = read

  useEffect(() => {
    let live = true

    void latest.current().match(
      (value) => {
        if (live) {
          setResult({ status: 'ready', value })
        }
      },
      () => {
        if (live) {
          setResult({ status: 'error' })
        }
      },
    )

    return () => {
      live = false
    }
  }, [reads])

  const again = useCallback(() => setReads((count) => count + 1), [])

  return { read: result, again }
}
