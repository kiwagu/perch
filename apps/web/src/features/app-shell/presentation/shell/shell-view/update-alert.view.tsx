import { match } from 'ts-pattern'

import { useT } from '@workspace/i18n'
import { Alert, AlertDescription } from '@workspace/ui/components/ui/alert'
import { Button } from '@workspace/ui/components/ui/button'

/** Why the page should load again: a newer build is served, or this build's sync is refused. */
export type UpdateCode = 'new-version' | 'protocol-outdated'

export interface UpdateAlertProps {
  /** The code the update message shows. */
  readonly update: UpdateCode
  /** Whether the frame's flow takes the update's reload now: the button is enabled while it does. */
  readonly canUpdate?: boolean | undefined
  readonly onUpdate?: (() => void) | undefined
}

/** Says the page should load again, with the reload that does it. */
export function UpdateAlert(props: UpdateAlertProps) {
  const t = useT()

  return (
    <Alert variant={props.update === 'protocol-outdated' ? 'destructive' : 'default'}>
      <AlertDescription data-testid="app-shell.update-message" data-code={props.update}>
        {match(props.update)
          .with('new-version', () => t('app.shell.update.new-version'))
          .with('protocol-outdated', () => t('app.shell.update.protocol-outdated'))
          .exhaustive()}
      </AlertDescription>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="mt-2 justify-self-start"
        disabled={!props.canUpdate}
        onClick={props.onUpdate}
        data-testid="app-shell.update-button"
      >
        {t('app.shell.reload')}
      </Button>
    </Alert>
  )
}
