/**
 * Where the fields of a page report whether they hold unsaved input, and where whoever guards
 * a leave reads it. A field reports through the channel while it is mounted; the scope says
 * whether any field holds unsaved input now. Outside a scope a field reports nowhere.
 */

import { createContext, type ReactNode, useContext, useMemo, useRef, useState } from 'react'

export interface UnsavedInputChannel {
  /** A field says whether it holds unsaved input now. */
  readonly report: (field: symbol, unsaved: boolean) => void
  /** A field leaves the page. */
  readonly forget: (field: symbol) => void
}

const ChannelContext = createContext<UnsavedInputChannel | undefined>(undefined)
const UnsavedContext = createContext(false)

export function UnsavedInputScope(props: { readonly children: ReactNode }) {
  const fields = useRef(new Set<symbol>())
  const [unsaved, setUnsaved] = useState(false)
  const channel = useMemo<UnsavedInputChannel>(
    () => ({
      report: (field, now) => {
        if (now) {
          fields.current.add(field)
        } else {
          fields.current.delete(field)
        }

        setUnsaved(fields.current.size > 0)
      },
      forget: (field) => {
        fields.current.delete(field)
        setUnsaved(fields.current.size > 0)
      },
    }),
    [],
  )

  return (
    <ChannelContext.Provider value={channel}>
      <UnsavedContext.Provider value={unsaved}>{props.children}</UnsavedContext.Provider>
    </ChannelContext.Provider>
  )
}

/** Whether a field of the scope holds unsaved input; false outside a scope. */
export const useUnsavedInput = (): boolean => useContext(UnsavedContext)

/** The channel a field reports to; none outside a scope. */
export const useUnsavedInputChannel = (): UnsavedInputChannel | undefined =>
  useContext(ChannelContext)
