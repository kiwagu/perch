import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  ConfirmDialog,
  type ConfirmDialogProps,
} from '@workspace/ui/components/platform/confirm-dialog'

function renderDialog(props: Partial<ConfirmDialogProps> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  render(
    <ConfirmDialog
      open
      title="Sign out?"
      description="Changes not sent are lost."
      confirmLabel="Sign out"
      cancelLabel="Stay"
      onConfirm={onConfirm}
      onCancel={onCancel}
      {...props}
    />,
  )

  return { onConfirm, onCancel }
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('ConfirmDialog', () => {
  it('marks the dialog with its anchor and code, and its two actions with derived anchors', () => {
    renderDialog({ testId: 'x.y.dialog', code: 'unsent-changes' })

    const dialog = screen.getByTestId('x.y.dialog')

    expect(dialog.getAttribute('data-code')).toBe('unsent-changes')
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(screen.getByTestId('x.y.dialog.confirm-button').textContent).toBe('Sign out')
    expect(screen.getByTestId('x.y.dialog.cancel-button').textContent).toBe('Stay')
  })

  it('reports the confirmation and the cancellation', async () => {
    const { onConfirm, onCancel } = renderDialog({ testId: 'x.y.dialog' })

    await userEvent.click(screen.getByTestId('x.y.dialog.confirm-button'))
    expect(onConfirm).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByTestId('x.y.dialog.cancel-button'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('shows its title and description, and carries no anchor without a testId', () => {
    renderDialog()

    expect(screen.getByText('Sign out?')).toBeTruthy()
    expect(screen.getByText('Changes not sent are lost.')).toBeTruthy()
    expect(document.querySelector('[data-testid]')).toBeNull()
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false, testId: 'x.y.dialog' })

    expect(screen.queryByTestId('x.y.dialog')).toBeNull()
  })
})
