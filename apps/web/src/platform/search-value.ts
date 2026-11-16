/**
 * A field bound to a search parameter (`binding: { search: <name> }` in the contract) that follows
 * the address: it starts with the value of that parameter, holds what is typed, and takes the
 * address's value again each time the route's search becomes another (a new search, a page, Back
 * or Forward), what was typed meanwhile dropped. So the field never disagrees with what the page
 * shows for the address. `useSearchStart` reads the address once instead, for a field that only
 * starts with it.
 */

import { useSearch } from '@tanstack/react-router'
import { useState } from 'react'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** What the field holds, and the route's search it was last given from. */
interface Held {
  readonly search: string
  readonly value: string
}

/**
 * The value of the search parameter `name` ('' without one) and what is typed since the route's
 * search last changed; the setter keeps what is typed.
 */
export function useSearchValue(name: string): readonly [string, (value: string) => void] {
  const search: unknown = useSearch({ strict: false })
  const values = isRecord(search) ? search : {}
  const now = JSON.stringify(values)
  const given = values[name]
  const address = typeof given === 'string' ? given : ''
  const [held, setHeld] = useState<Held>({ search: now, value: address })

  // A new search gives the field the address's value, and what was typed before is gone, even when
  // Back returns to the search it was typed at.
  if (held.search !== now) {
    setHeld({ search: now, value: address })
  }

  const value = held.search === now ? held.value : address

  return [value, (typed: string) => setHeld({ search: now, value: typed })]
}
