import { match } from 'ts-pattern'

import { useT } from '@workspace/i18n'

/**
 * Where the start is: starting, opening a signed-in account's data around its screen, ready,
 * failed to open that data, failed to start (the app's code did not load or run), or stopped
 * because the browser keeps no site data.
 */
export type ShellStatus =
  | 'opening'
  | 'opening-data'
  | 'ready'
  | 'failed'
  | 'start-failed'
  | 'storage-blocked'

export interface StatusLineProps {
  readonly status: ShellStatus
}

/**
 * The frame's one status line: visually hidden once ready, the visible message otherwise (beside
 * the screen while a signed-in account's data opens).
 */
export function StatusLine(props: StatusLineProps) {
  const t = useT()

  return (
    <p
      className={props.status === 'ready' ? 'sr-only' : 'text-muted-foreground'}
      data-testid="app-shell.status"
      data-state={props.status}
      role="status"
    >
      {match(props.status)
        .with('ready', () => t('app.shell.sync.local'))
        .with('opening', () => t('app.shell.starting'))
        .with('opening-data', () => t('app.shell.opening-db'))
        .with('storage-blocked', () => t('app.shell.storage-blocked'))
        .with('failed', () => t('app.shell.failed'))
        .with('start-failed', () => t('app.shell.start-failed'))
        .exhaustive()}
    </p>
  )
}
