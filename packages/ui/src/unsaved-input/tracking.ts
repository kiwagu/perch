/**
 * What a field does to know whether it holds unsaved input: it remembers the last value the
 * app gave it (the `value` prop whenever it did not come from the field's own last change, or
 * the `defaultValue` at mount) and is unsaved while its current value differs from it. It
 * reports to the scope's channel, and lets its form mark the value a saved submit took.
 *
 * Its state follows: `unsaved` while it holds unsaved input; `saved` while it shows the value a
 * saved submit took and the app last gave it that value, and only when the scope says its anchor
 * shows a stored value; none otherwise. The saved value lives in this instance alone: a remount
 * starts with none, and the app giving another value clears it.
 *
 * A render only reads: what the field was given and what it showed are written once React
 * commits, so a render React abandons (a transition that never commits) leaves no trace.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'

import type { FieldState } from '@workspace/ui-contract/anchors'

import { useFormScope } from './form-scope'
import { useStoresValue, useUnsavedInputChannel } from './scope'

export interface TrackedInput<Value> {
  /** False for a field whose own change runs its action: it never holds unsaved input. */
  readonly holdsInput: boolean
  /** The anchor the field renders, which it reports with what it holds; none without one. */
  readonly anchor: string | undefined
  /** The controlled value; undefined for an uncontrolled field. */
  readonly value: Value | undefined
  /** What an uncontrolled field starts with: its default value, else its empty one. */
  readonly defaultValue: Value
  /** Whether two values are the same; `Object.is` when left out. */
  readonly same?: ((a: Value, b: Value) => boolean) | undefined
}

const bump = (count: number): number => count + 1

export function useTracksInput<Value>(input: TrackedInput<Value>): {
  readonly typed: (next: Value) => void
  readonly state: FieldState | undefined
} {
  const channel = useUnsavedInputChannel()
  const stores = useStoresValue()
  const form = useFormScope()
  const same = input.same ?? Object.is
  const [id] = useState(() => Symbol('field'))
  const [uncontrolled, setUncontrolled] = useState(() => input.defaultValue)
  const [, rerender] = useState(0)
  // As of the last commit: the last value the app gave the field, and what it showed.
  const given = useRef(input.value === undefined ? input.defaultValue : input.value)
  const shown = useRef(given.current)
  // What the field's own last change was; set by the change, before the render it causes.
  const typedLast = useRef<{ readonly value: Value } | undefined>(undefined)
  // The value the last saved submit took, while the app has given no other since.
  const saved = useRef<{ readonly value: Value } | undefined>(undefined)

  const current = input.value === undefined ? uncontrolled : input.value
  const echoed =
    input.value !== undefined &&
    typedLast.current !== undefined &&
    same(input.value, typedLast.current.value)
  const givenNow = input.value !== undefined && !echoed ? input.value : given.current
  const unsaved = input.holdsInput && !same(current, givenNow)
  const { anchor } = input
  const isSaved =
    input.holdsInput &&
    saved.current !== undefined &&
    anchor !== undefined &&
    stores(anchor) &&
    same(current, saved.current.value) &&
    same(givenNow, saved.current.value)
  const state: FieldState | undefined = unsaved ? 'unsaved' : isSaved ? 'saved' : undefined

  useLayoutEffect(() => {
    given.current = givenNow
    shown.current = current

    if (saved.current !== undefined && !same(givenNow, saved.current.value)) {
      saved.current = undefined
    }
  })

  useEffect(() => {
    channel?.report(id, unsaved, anchor)
  }, [channel, id, unsaved, anchor])
  useEffect(() => () => channel?.forget(id), [channel, id])

  const capture = useCallback(() => {
    const submitted = shown.current

    return () => {
      given.current = submitted
      saved.current = { value: submitted }
      rerender(bump)
    }
  }, [])

  useEffect(() => form?.enlist(capture), [form, capture])

  const typed = useCallback((next: Value) => {
    typedLast.current = { value: next }
    setUncontrolled(() => next)
  }, [])

  return { typed, state }
}
