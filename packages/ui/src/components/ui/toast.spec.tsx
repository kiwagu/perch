import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Toast, Toaster } from '@workspace/ui/components/ui/toast'

describe('Toaster', () => {
  it('announces its toasts politely, in the order given, each with its code', async () => {
    const onDismiss = vi.fn()

    render(
      <Toaster>
        <Toast data-testid="shell.toast" code="note-updated" onDismiss={onDismiss}>
          Note saved
        </Toast>
        <Toast data-testid="shell.toast" code="note-created" onDismiss={() => {}}>
          Note added
        </Toast>
      </Toaster>,
    )

    const region = screen.getByRole('status')
    const toasts = screen.getAllByTestId('shell.toast')

    expect(region.getAttribute('aria-live')).toBe('polite')
    expect(toasts.map((toast) => toast.getAttribute('data-code'))).toEqual([
      'note-updated',
      'note-created',
    ])

    await userEvent.click(screen.getByRole('button', { name: 'Note saved' }))

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('keeps one region from empty on, a list inside it, and announces each addition alone', () => {
    const { container, rerender } = render(<Toaster />)
    const region = within(container).getByRole('status')

    expect(region.getAttribute('aria-atomic')).toBe('false')
    expect(within(region).queryAllByRole('listitem')).toEqual([])

    rerender(
      <Toaster>
        <Toast data-testid="shell.toast" code="note-created" onDismiss={() => {}}>
          Note added
        </Toast>
      </Toaster>,
    )

    expect(within(container).getByRole('status')).toBe(region)
    expect(within(within(region).getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
  })
})
