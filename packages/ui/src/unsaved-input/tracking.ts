/**
 * What a field does to know whether it holds unsaved input: it remembers the last value the
 * app gave it (the `value` prop whenever it did not come from the field's own last change, or
 * the `defaultValue` at mount) and is unsaved while its current value differs from it. It
 * reports to the scope's channel, and lets its form mark it clean after a submit that saved.
 */

import { useCallback, useEffect, useReducer, useRef } from 'react'

import { useFormScope } from './form-scope'
import { useUnsavedInputChannel } from './scope'

export interface TrackedInput {
  /** False for a field whose own change runs its action: it never holds unsaved input. */
  readonly holdsInput: boolean
  /** The controlled value, as text; undefined for an uncontrolled field. */
  readonly value: string | undefined
  readonly defaultValue: string | undefined
}

const bump = (count: number): number => count + 1

export function useTracksInput(input: TrackedInput): { readonly typed: (next: string) => void } {
  const channel = useUnsavedInputChannel()
  const form = useFormScope()
  const [, rerender] = useReducer(bump, 0)
  const field = useRef<symbol | undefined>(undefined)

  field.current ??= Symbol('field')

  const id = field.current
  const given = useRef(input.value ?? input.defaultValue ?? '')
  const typedLast = useRef<string | undefined>(undefined)
  const current = useRef(given.current)
  const controlled = useRef(false)

  controlled.current = input.value !== undefined

  if (input.value !== undefined) {
    if (input.value !== typedLast.current) {
      // The app gave the field a value: what it shows now is what it was given.
      given.current = input.value
    }

    current.current = input.value
  }

  const unsaved = input.holdsInput && current.current !== given.current

  useEffect(() => {
    channel?.report(id, unsaved)
  }, [channel, id, unsaved])
  useEffect(() => () => channel?.forget(id), [channel, id])

  const markClean = useCallback(() => {
    given.current = current.current
    typedLast.current = undefined
    rerender()
  }, [])

  useEffect(() => form?.enlist(markClean), [form, markClean])

  const typed = useCallback((next: string) => {
    typedLast.current = next

    if (!controlled.current) {
      current.current = next
      rerender()
    }
  }, [])

  return { typed }
}
