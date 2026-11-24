import { match } from 'ts-pattern'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'

import type { ShellEvent } from '../../../application/shell-machine'

/** How the app installs: by the browser's own window, or by steps the user follows. */
export type InstallCode = 'install-available' | 'install-by-steps'

export interface InstallAlertProps {
  /** The code the reminder to install the app shows. */
  readonly install: InstallCode
  /** Whether the frame's flow takes `event` now: a button is enabled while it takes its press. */
  readonly can: (event: ShellEvent) => boolean
  readonly onInstall?: (() => void) | undefined
  readonly onPostponeInstall?: (() => void) | undefined
}

/** Reminds to install the app, with its install button where the browser offers one, and later. */
export function InstallAlert(props: InstallAlertProps) {
  const t = useT()

  return (
    <Alert>
      <AlertDescription data-testid="app-shell.install-message" data-code={props.install}>
        {match(props.install)
          .with('install-available', () => t('app.shell.install.available'))
          .with('install-by-steps', () => t('app.shell.install.by-steps'))
          .exhaustive()}
      </AlertDescription>
      <div className="mt-2 flex flex-wrap gap-2">
        {props.install === 'install-available' ? (
          <Button
            type="button"
            size="sm"
            disabled={!props.can({ type: 'app-shell.install-button' })}
            onClick={props.onInstall}
            data-testid="app-shell.install-button"
          >
            {t('app.shell.install.install')}
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={!props.can({ type: 'app-shell.install-later-button' })}
          onClick={props.onPostponeInstall}
          data-testid="app-shell.install-later-button"
        >
          {t('app.shell.install.later')}
        </Button>
      </div>
    </Alert>
  )
}
