import { type KeyboardEvent, type ReactNode, useRef } from 'react'

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

import type { ConfirmDialogProps } from './confirm-dialog'

export interface InputDialogProps extends ConfirmDialogProps {
  /** What the dialog asks for: its first input has the focus once the dialog opens. */
  readonly children: ReactNode
  /** The confirm button, and Enter in an input, do nothing while this holds (the flow does not take the event). */
  readonly confirmDisabled?: boolean
}

/**
 * A modal question that asks for something typed, such as a code: a `ConfirmDialog` that holds
 * `children` (the inputs) between its text and its two actions. The first input has the focus on
 * open, Enter in an input presses the confirm button, which does nothing while it is disabled,
 * and Escape is the cancel button.
 */
export function InputDialog(props: InputDialogProps) {
  const { testId } = props
  const confirmTestId = testId === undefined ? undefined : testIdFor(testId, 'confirm-button')
  const cancelTestId = testId === undefined ? undefined : testIdFor(testId, 'cancel-button')
  const inputs = useRef<HTMLDivElement>(null)
  const confirm = useRef<HTMLButtonElement>(null)
  const confirmOnEnter = (event: KeyboardEvent) => {
    if (
      event.key === 'Enter' &&
      !event.nativeEvent.isComposing &&
      event.target instanceof HTMLInputElement
    ) {
      event.preventDefault()
      confirm.current?.click()
    }
  }

  return (
    <AlertDialog
      open={props.open}
      onOpenChange={(open) => {
        if (!open) {
          props.onCancel()
        }
      }}
    >
      <AlertDialogContent
        data-testid={testId}
        data-code={props.code}
        initialFocus={() => inputs.current?.querySelector('input') ?? true}
        onKeyDown={confirmOnEnter}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{props.title}</AlertDialogTitle>
          <AlertDialogDescription>{props.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div ref={inputs}>{props.children}</div>
        <AlertDialogFooter>
          <AlertDialogCancel data-testid={cancelTestId}>{props.cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            ref={confirm}
            type="button"
            variant={props.destructive ? 'destructive' : 'default'}
            disabled={props.confirmDisabled}
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
