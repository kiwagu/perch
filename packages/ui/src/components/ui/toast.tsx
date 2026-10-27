/**
 * Short-lived notifications. `Toaster` is the region they stack in, centred at the top, in the
 * order given (the app puts the newest first): a polite live region that stays mounted from empty
 * on and announces each addition alone, around a list; `Toast` is one of them, carrying the code
 * of what it says and its tone (a success, a warning or an error, in the theme's `success`,
 * `warning` and `destructive`), and a click on it, its cross included, dismisses it. The app owns
 * the list and how long each stays.
 */

import { cva } from 'class-variance-authority'
import { cn } from 'cn'
import { CircleCheckIcon, CircleXIcon, TriangleAlertIcon, XIcon } from 'lucide-react'
import type * as React from 'react'

const toastVariants = cva(
  'flex w-full items-start gap-3 rounded-lg border px-4 py-3 text-left text-sm break-words text-card-foreground shadow-md',
  {
    variants: {
      tone: {
        success:
          'border-success/50 bg-[color-mix(in_oklab,var(--color-success)_12%,var(--color-card))] [&>svg:first-child]:text-success',
        warning:
          'border-warning/50 bg-[color-mix(in_oklab,var(--color-warning)_12%,var(--color-card))] [&>svg:first-child]:text-warning',
        error:
          'border-destructive/50 bg-[color-mix(in_oklab,var(--color-destructive)_12%,var(--color-card))] [&>svg:first-child]:text-destructive',
      },
    },
  },
)

/** What a toast says: a success, a warning or an error. */
type ToastTone = 'success' | 'warning' | 'error'

const ICONS: Readonly<Record<ToastTone, typeof CircleCheckIcon>> = {
  success: CircleCheckIcon,
  warning: TriangleAlertIcon,
  error: CircleXIcon,
}

function Toaster({ className, ...props }: React.ComponentProps<'ol'>) {
  return (
    <div
      data-slot="toaster"
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className={cn(
        'pointer-events-none fixed top-4 left-1/2 z-50 w-[calc(100%-2rem)] max-w-sm -translate-x-1/2',
        className,
      )}
    >
      <ol className="flex flex-col gap-2" {...props} />
    </div>
  )
}

function Toast({
  className,
  code,
  tone,
  onDismiss,
  children,
  ...props
}: Omit<React.ComponentProps<'li'>, 'onClick'> & {
  readonly code: string
  readonly tone: ToastTone
  readonly onDismiss: () => void
}) {
  const Icon = ICONS[tone]

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
      <button type="button" onClick={onDismiss} className={toastVariants({ tone })}>
        <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span className="flex-1">{children}</span>
        <XIcon aria-hidden className="mt-0.5 size-4 shrink-0 opacity-60" />
      </button>
    </li>
  )
}

export { Toast, Toaster, type ToastTone }
