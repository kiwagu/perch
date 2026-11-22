import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { InputDialog, type InputDialogProps } from '@workspace/ui/components/platform/input-dialog'
import { Input } from '@workspace/ui/components/ui/input'

function renderDialog(props: Partial<InputDialogProps> = {}) {
  const onConfirm = vi.fn()
  const onCancel = vi.fn()

  render(
    <InputDialog
      open
      title="Enter the code"
      description="Your authenticator app shows it."
      confirmLabel="Continue"
      cancelLabel="Back"
      onConfirm={onConfirm}
      onCancel={onCancel}
      testId="x.y.dialog"
      code="code-required"
      {...props}
    >
      <Input aria-label="Code" data-testid="x.y.input" />
    </InputDialog>,
  )

  return { onConfirm, onCancel }
}

// Without vitest globals, Testing Library cannot register its own cleanup.
afterEach(() => cleanup())

describe('InputDialog', () => {
  it('marks the dialog with its anchor and code, holds its content and derives the anchors of its two actions', () => {
    renderDialog()

    const dialog = screen.getByTestId('x.y.dialog')

    expect(dialog.getAttribute('data-code')).toBe('code-required')
    expect(dialog.getAttribute('role')).toBe('alertdialog')
    expect(dialog.contains(screen.getByTestId('x.y.input'))).toBe(true)
    expect(screen.getByText('Enter the code')).toBeTruthy()
    expect(screen.getByText('Your authenticator app shows it.')).toBeTruthy()
    expect(screen.getByTestId('x.y.dialog.confirm-button').textContent).toBe('Continue')
    expect(screen.getByTestId('x.y.dialog.cancel-button').textContent).toBe('Back')
  })

  it('focuses its input once it opens', async () => {
    renderDialog()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('x.y.input')))
  })

  it('reports the confirmation and the cancellation of the buttons', async () => {
    const { onConfirm, onCancel } = renderDialog()

    await userEvent.click(screen.getByTestId('x.y.dialog.confirm-button'))
    expect(onConfirm).toHaveBeenCalledOnce()

    await userEvent.click(screen.getByTestId('x.y.dialog.cancel-button'))
    expect(onCancel).toHaveBeenCalledOnce()
  })

  it('confirms on Enter in its input, once, as the confirm button does', async () => {
    const { onConfirm, onCancel } = renderDialog()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('x.y.input')))
    await userEvent.keyboard('123456{Enter}')

    expect(onConfirm).toHaveBeenCalledOnce()
    expect(onCancel).not.toHaveBeenCalled()
  })

  it('cancels on Escape, as the cancel button does', async () => {
    const { onConfirm, onCancel } = renderDialog()

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('x.y.input')))
    await userEvent.keyboard('{Escape}')

    expect(onCancel).toHaveBeenCalledOnce()
    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('holds the confirm button, and so Enter, while the confirmation is not taken', async () => {
    const { onConfirm } = renderDialog({ confirmDisabled: true })

    const confirm = screen.getByTestId('x.y.dialog.confirm-button') as HTMLButtonElement

    expect(confirm.disabled).toBe(true)

    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('x.y.input')))
    await userEvent.keyboard('123456{Enter}')
    await userEvent.click(confirm)

    expect(onConfirm).not.toHaveBeenCalled()
  })

  it('leaves the confirm button enabled unless told to hold it', () => {
    renderDialog()

    expect((screen.getByTestId('x.y.dialog.confirm-button') as HTMLButtonElement).disabled).toBe(
      false,
    )
  })

  it('carries no anchor of its own without a testId', () => {
    render(
      <InputDialog
        open
        title="Enter the code"
        description="Your authenticator app shows it."
        confirmLabel="Continue"
        cancelLabel="Back"
        onConfirm={() => {}}
        onCancel={() => {}}
      >
        <Input aria-label="Code" data-testid="x.y.input" />
      </InputDialog>,
    )

    expect(
      [...document.querySelectorAll('[data-testid]')].map((each) =>
        each.getAttribute('data-testid'),
      ),
    ).toEqual(['x.y.input'])
  })

  it('renders nothing while closed', () => {
    renderDialog({ open: false })

    expect(screen.queryByTestId('x.y.dialog')).toBeNull()
    expect(screen.queryByTestId('x.y.input')).toBeNull()
  })
})
