import type { ReactNode } from 'react'

import { cn } from '@workspace/ui/lib/utils'

export interface AppShellProps {
  readonly brand: ReactNode
  readonly actions?: ReactNode
  /** Navigation items: a bottom bar on small screens, a side rail from `lg`. */
  readonly navigation: ReactNode
  readonly navigationLabel: string
  readonly status?: ReactNode
  readonly children?: ReactNode
  readonly className?: string
}

/**
 * The page frame. Mobile first: one column, a fixed bottom navigation and room
 * for the device's safe areas; from `lg` the navigation becomes a side rail.
 */
export function AppShell(props: AppShellProps) {
  return (
    <div
      className={cn(
        'flex min-h-dvh flex-col bg-background pt-[env(safe-area-inset-top)] text-foreground lg:flex-row-reverse',
        props.className,
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-14 items-center justify-between gap-2 border-b px-4">
          <div className="min-w-0 truncate font-heading font-semibold">{props.brand}</div>
          <div className="flex items-center gap-2">{props.actions}</div>
        </header>
        <main className="flex flex-1 flex-col gap-4 px-4 py-4 pb-24 lg:pb-4">
          {props.status}
          {props.children}
        </main>
      </div>
      <nav
        aria-label={props.navigationLabel}
        className="fixed inset-x-0 bottom-0 z-10 flex border-t bg-background pb-[env(safe-area-inset-bottom)] lg:static lg:w-60 lg:flex-col lg:gap-1 lg:border-t-0 lg:border-r lg:p-3"
      >
        {props.navigation}
      </nav>
    </div>
  )
}
