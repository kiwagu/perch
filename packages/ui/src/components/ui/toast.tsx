/**
 * Short-lived notifications. `Toaster` is the region they stack in, at the top right, in the order
 * given (the app puts the newest first); `Toast` is one of them, carrying the code of what it
 * says, and a click on it dismisses it. The app owns the list and how long each stays.
 */

import { cn } from 'cn'
import type * as React from 'react'

function Toaster({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <ol
      data-slot="toaster"
      role="status"
      aria-live="polite"
      className={cn(
        'pointer-events-none fixed top-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-sm flex-col gap-2',
        className,
      )}
      {...props}
    />
  )
}

function Toast({
  className,
  code,
  onDismiss,
  children,
  ...props
}: Omit<React.ComponentProps<'li'>, 'onClick'> & {
  readonly code: string
  readonly onDismiss: () => void
}) {
  return (
    <li
      data-slot="toast"
      data-code={code}
      className={cn(
        'pointer-events-auto animate-in duration-200 fade-in-0 slide-in-from-top-2',
        className,
      )}
      {...props}
    >
      <button
        type="button"
        onClick={onDismiss}
        className="w-full rounded-lg border bg-card px-4 py-3 text-left text-sm text-card-foreground shadow-md"
      >
        {children}
      </button>
    </li>
  )
}

export { Toast, Toaster }
