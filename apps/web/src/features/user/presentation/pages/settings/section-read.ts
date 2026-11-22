import type { ResultAsync } from 'neverthrow'
import { useCallback, useEffect, useRef, useState } from 'react'

/** What a section of the page knows of what it reads: not yet, not at all, or the value read. */
export type SectionRead<T> =
  | { readonly status: 'loading' }
  | { readonly status: 'error' }
  | { readonly status: 'ready'; readonly value: T }

/**
 * Reads what a section shows when the page opens, and again each time `again` is called (the
 * flow's `read` of the section after an action). The section is as unread (`loading`) from the
 * moment a read is asked until it answers, so the answer of an earlier read is never shown as
 * current; one that fails leaves it saying it could not be read, and a read that is no longer the
 * latest, or ends after the page has gone, says nothing.
 */
export function useSectionRead<T>(read: () => ResultAsync<T, unknown>): {
  readonly read: SectionRead<T>
  readonly again: () => void
} {
  const [result, setResult] = useState<SectionRead<T>>({ status: 'loading' })
  const [reads, setReads] = useState(0)
  // The read whose answer counts: asking another, or the page going, makes every other one stale.
  const counting = useRef(0)
  // The read is taken when an effect runs, so a render that makes a new one reads nothing.
  const latest = useRef(read)

  latest.current = read

  useEffect(() => {
    const mine = counting.current

    void latest.current().match(
      (value) => {
        if (counting.current === mine) {
          setResult({ status: 'ready', value })
        }
      },
      () => {
        if (counting.current === mine) {
          setResult({ status: 'error' })
        }
      },
    )

    return () => {
      counting.current += 1
    }
  }, [reads])

  const again = useCallback(() => {
    counting.current += 1
    setResult({ status: 'loading' })
    setReads((count) => count + 1)
  }, [])

  return { read: result, again }
}
