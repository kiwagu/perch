import { useT } from '@workspace/i18n'
import { Button } from '@workspace/ui/components/ui/button'

export interface SignOutHereProps {
  readonly onSignOutHere: () => void
  /** That sign-out runs: the button waits for it. */
  readonly signingOutHere?: boolean | undefined
}

/** Signs the saved account out on this device, when its data could not be opened. */
export function SignOutHere(props: SignOutHereProps) {
  const t = useT()

  return (
    <Button
      type="button"
      variant="outline"
      className="self-start"
      disabled={props.signingOutHere}
      onClick={props.onSignOutHere}
      data-testid="app-shell.sign-out-here-button"
    >
      {t('app.shell.sign-out-here')}
    </Button>
  )
}
