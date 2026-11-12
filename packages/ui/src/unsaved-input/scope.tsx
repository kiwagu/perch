/**
 * Where the fields of a page report whether they hold unsaved input, and where whoever guards
 * a leave reads it. A field reports through the channel while it is mounted, with the anchor it
 * renders; the scope says whether any field holds unsaved input now, and, read when a question is
 * asked, which ones by their anchors, so a leave that carries some fields asks only for the others.
 * Each field is its own: two that render one anchor are two. Outside a scope a field reports
 * nowhere.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react'

export interface UnsavedInputChannel {
  /** A field says whether it holds unsaved input now, and the anchor it renders, if any. */
  readonly report: (field: symbol, unsaved: boolean, anchor: string | undefined) => void
  /** A field leaves the page. */
  readonly forget: (field: symbol) => void
}

/** The fields that hold unsaved input, by the anchors they render; `unnamed` when one renders none. */
export interface UnsavedFields {
  readonly anchors: ReadonlySet<string>
  readonly unnamed: boolean
}

const NONE: UnsavedFields = { anchors: new Set(), unnamed: false }

const ChannelContext = createContext<UnsavedInputChannel | undefined>(undefined)
const UnsavedContext = createContext(false)
const FieldsContext = createContext<() => UnsavedFields>(() => NONE)

export function UnsavedInputScope(props: { readonly children: ReactNode }) {
  const fields = useRef(new Map<symbol, string | undefined>())
  const [unsaved, setUnsaved] = useState(false)
  const channel = useMemo<UnsavedInputChannel>(
    () => ({
      report: (field, now, anchor) => {
        if (now) {
          fields.current.set(field, anchor)
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
  const read = useCallback((): UnsavedFields => {
    const named = [...fields.current.values()]

    return {
      anchors: new Set(named.filter((anchor): anchor is string => anchor !== undefined)),
      unnamed: named.includes(undefined),
    }
  }, [])

  return (
    <ChannelContext.Provider value={channel}>
      <FieldsContext.Provider value={read}>
        <UnsavedContext.Provider value={unsaved}>{props.children}</UnsavedContext.Provider>
      </FieldsContext.Provider>
    </ChannelContext.Provider>
  )
}

/** Whether a field of the scope holds unsaved input; false outside a scope. */
export const useUnsavedInput = (): boolean => useContext(UnsavedContext)

/**
 * Reads, each time it is called, which fields of the scope hold unsaved input now: what a guard
 * asks when a question comes, never a render's value. Now is as the fields last reported, which
 * they do in an effect after a render commits, so a read in the very handler that changed a field
 * sees what it held before. Outside a scope it reads none.
 */
export const useUnsavedFields = (): (() => UnsavedFields) => useContext(FieldsContext)

/** The channel a field reports to; none outside a scope. */
export const useUnsavedInputChannel = (): UnsavedInputChannel | undefined =>
  useContext(ChannelContext)
