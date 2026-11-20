import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'

import type { ShellEvent } from '../../../application/shell-machine'

export interface SignOutHereProps {
  /** Whether the frame's flow takes `event` now: the button is enabled while it takes its press. */
  readonly can: (event: ShellEvent) => boolean
  readonly onSignOutHere: () => void
}

/** Signs the saved account out on this device, when its data could not be opened. */
export function SignOutHere(props: SignOutHereProps) {
  const t = useT()

  return (
    <Button
      type="button"
      variant="outline"
      className="self-start"
      disabled={!props.can({ type: 'app-shell.sign-out-here-button' })}
      onClick={props.onSignOutHere}
      data-testid="app-shell.sign-out-here-button"
    >
      {t('app.shell.sign-out-here')}
    </Button>
  )
}
