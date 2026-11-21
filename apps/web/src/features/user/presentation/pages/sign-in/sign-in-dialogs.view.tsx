import { useT } from '@workspace/i18n'
import { ConfirmDialog } from '@workspace/ui/components/platform/confirm-dialog'

export interface DeviceLimitDialogProps {
  /** Whether the flow's state renders the dialog. */
  readonly open: boolean
  /** Signs in all the same, which signs out the account's device seen least recently. */
  readonly onConfirm: () => void
  /** Goes back to the form, signing nothing in. */
  readonly onCancel: () => void
}

/** The question asked once a sign-in finds the account signed in on as many devices as it may be. */
export function DeviceLimitDialog(props: DeviceLimitDialogProps) {
  const t = useT()

  return (
    <ConfirmDialog
      open={props.open}
      title={t('user.sign-in.device-limit.title')}
      description={t('user.sign-in.device-limit.body')}
      confirmLabel={t('user.sign-in.device-limit.confirm')}
      cancelLabel={t('user.sign-in.device-limit.cancel')}
      destructive
      onConfirm={props.onConfirm}
      onCancel={props.onCancel}
      testId="user.sign-in.device-limit-dialog"
      code="device-limit"
    />
  )
}
