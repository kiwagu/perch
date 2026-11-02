/**
 * A field's binding `{ search: <name> }`: the field starts with the value of that search parameter
 * of the address the screen was opened at, and holds what is typed from then on. The route
 * validated the search already; a `secret` field never starts this way (the contract refuses it).
 */

import { useSearch } from '@tanstack/react-router'
import { useState } from 'react'

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null

/** The value of the search parameter `name` when the screen opened, read once; '' without one. */
export function useSearchStart(name: string): string {
  const search: unknown = useSearch({ strict: false })
  const [start] = useState(() => {
    const value = isRecord(search) ? search[name] : undefined

    return typeof value === 'string' ? value : ''
  })

  return start
}
