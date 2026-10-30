import type { ReactNode } from 'react'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@workspace/ui/components/ui/alert-dialog'
import { testIdFor } from '@workspace/ui-contract/anchors'

export interface ConfirmDialogProps {
  readonly open: boolean
  readonly title: ReactNode
  readonly description: ReactNode
  readonly confirmLabel: ReactNode
  readonly cancelLabel: ReactNode
  /** The confirmation loses something: its button says so. */
  readonly destructive?: boolean
  readonly onConfirm: () => void
  /** The cancel button, Escape, or a click outside the dialog. */
  readonly onCancel: () => void
  /** The dialog's anchor; its buttons carry `<testId>.confirm-button` and `<testId>.cancel-button`. */
  readonly testId?: string
  /** The contract code of what the dialog asks, as `data-code`. */
  readonly code?: string
}

/** A modal question with one action and a way back, such as "Sign out and lose the changes?". */
export function ConfirmDialog(props: ConfirmDialogProps) {
  const { testId } = props
  const confirmTestId = testId === undefined ? undefined : testIdFor(testId, 'confirm-button')
  const cancelTestId = testId === undefined ? undefined : testIdFor(testId, 'cancel-button')

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel()
        }
      }}
    >
      <AlertDialogContent data-testid={testId} data-code={props.code}>
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={cancelTestId}>{props.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant={props.destructive ? 'destructive' : 'default'}
            onClick={props.onConfirm}
            data-testid={confirmTestId}
          >
            {props.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
