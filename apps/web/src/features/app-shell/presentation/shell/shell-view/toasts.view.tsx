import { Toast, Toaster } from '@workspace/ui/components/ui/toast'

import type { ToastTone } from '../../../../../platform/toasts'

/** A toast shown: its code, its tone and its words in the language the app speaks. */
export interface ShellToast {
  readonly id: number
  readonly code: string
  readonly tone: ToastTone
  readonly text: string
}

export interface ToastsProps {
  /** The toasts shown, the newest first. */
  readonly toasts?: readonly ShellToast[] | undefined
  readonly onDismissToast?: ((id: number) => void) | undefined
}

/** The frame's toasts, the newest first, each dismissed by a click. */
export function Toasts(props: ToastsProps) {
  return (
    <Toaster>
      {(props.toasts ?? []).map((toast) => (
        <Toast
          key={toast.id}
          data-testid="app-shell.toast"
          code={toast.code}
          tone={toast.tone}
          onDismiss={() => props.onDismissToast?.(toast.id)}
        >
          {toast.text}
        </Toast>
      ))}
    </Toaster>
  )
}
