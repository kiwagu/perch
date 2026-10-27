/**
 * The toasts of what the user changed, for a short while in the tab that acted: the newest at the
 * top, each gone after `TOAST_LIFETIME_MS` or when dismissed. The frame gives the tone and the
 * words of each code and renders the list.
 */

import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react'

import type { Translate } from '@workspace/i18n'

import { entryOf } from './texts'

export const TOAST_LIFETIME_MS = 5_000

/** What a toast says: a success, a warning or an error. */
export type ToastTone = 'success' | 'warning' | 'error'

/** What the toast says for each code: its tone and its words. */
export type ToastWords = Readonly<
  Record<string, { readonly tone: ToastTone; readonly text: (t: Translate) => string }>
>

export interface Toast {
  readonly id: number
  /** The contract code of what it says (`note-created`), shown as `data-code`. */
  readonly code: string
  readonly tone: ToastTone
  readonly text: (t: Translate) => string
}

interface ToastChannel {
  readonly toasts: readonly Toast[]
  readonly push: (code: string) => void
  readonly dismiss: (id: number) => void
}

const ToastContext = createContext<ToastChannel>({
  toasts: [],
  push: () => {},
  dismiss: () => {},
})

export function ToastProvider(props: { readonly texts: ToastWords; readonly children: ReactNode }) {
  const { texts } = props
  const [toasts, setToasts] = useState<readonly Toast[]>([])
  const last = useRef(0)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())
  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((shown) => shown.filter((toast) => toast.id !== id))
  }, [])
  const push = useCallback(
    (code: string) => {
      const { tone, text } = entryOf(texts, code, 'toast')

      last.current += 1

      const id = last.current

      setToasts((shown) => [{ id, code, tone, text }, ...shown])
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), TOAST_LIFETIME_MS),
      )
    },
    [texts, dismiss],
  )

  useEffect(() => {
    const pending = timers.current

    return () => {
      for (const timer of pending.values()) {
        clearTimeout(timer)
      }
    }
  }, [])

  const channel = useMemo(() => ({ toasts, push, dismiss }), [toasts, push, dismiss])

  return <ToastContext.Provider value={channel}>{props.children}</ToastContext.Provider>
}

export const useToasts = (): readonly Toast[] => useContext(ToastContext).toasts

export const usePushToast = (): ((code: string) => void) => useContext(ToastContext).push

export const useDismissToast = (): ((id: number) => void) => useContext(ToastContext).dismiss
