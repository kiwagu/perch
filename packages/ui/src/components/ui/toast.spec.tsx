import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { Toast, Toaster } from '@workspace/ui/components/ui/toast'

describe('Toaster', () => {
  it('announces its toasts politely, in the order given, each with its code', async () => {
    const onDismiss = vi.fn()

    render(
      <Toaster>
        <Toast data-testid="shell.toast" code="note-updated" tone="success" onDismiss={onDismiss}>
          Note saved
        </Toast>
        <Toast data-testid="shell.toast" code="note-created" tone="success" onDismiss={() => {}}>
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
        <Toast data-testid="shell.toast" code="note-created" tone="success" onDismiss={() => {}}>
          Note added
        </Toast>
      </Toaster>,
    )

    expect(within(container).getByRole('status')).toBe(region)
    expect(within(within(region).getByRole('list')).getAllByRole('listitem')).toHaveLength(1)
  })

  it('marks each tone by its icon and offers the cross that dismisses, named by its words', () => {
    const { container } = render(
      <Toaster>
        <Toast code="note-created" tone="success" onDismiss={() => {}}>
          Note added
        </Toast>
        <Toast code="slow-network" tone="warning" onDismiss={() => {}}>
          Slow network
        </Toast>
        <Toast code="note-lost" tone="error" onDismiss={() => {}}>
          Note lost
        </Toast>
      </Toaster>,
    )
    const icons = (name: string) =>
      Array.from(within(container).getByRole('button', { name }).querySelectorAll('svg')).map(
        (icon) => icon.getAttribute('class') ?? '',
      )

    expect(icons('Note added')).toEqual([
      expect.stringContaining('lucide-circle-check'),
      expect.stringContaining('lucide-x'),
    ])
    expect(icons('Slow network')[0]).toContain('lucide-triangle-alert')
    expect(icons('Note lost')[0]).toContain('lucide-circle-x')
  })
})
