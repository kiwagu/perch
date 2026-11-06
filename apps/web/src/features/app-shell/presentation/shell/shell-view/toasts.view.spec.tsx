// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { Toasts } from './toasts.view'

describe('Toasts', () => {
  it('renders the toasts, newest first, each dismissed by a click', () => {
    const onDismissToast = vi.fn()

    renderWithProviders(
      <Toasts
        toasts={[
          { id: 2, code: 'note-updated', tone: 'success', text: 'Note saved.' },
          { id: 1, code: 'note-created', tone: 'success', text: 'Note added.' },
        ]}
        onDismissToast={onDismissToast}
      />,
    )

    const toasts = screen.getAllByTestId('app-shell.toast')

    expect(toasts.map((toast) => toast.getAttribute('data-code'))).toEqual([
      'note-updated',
      'note-created',
    ])

    fireEvent.click(screen.getByRole('button', { name: 'Note saved.' }))

    expect(onDismissToast).toHaveBeenCalledWith(2)
  })

  it('draws each toast in its tone', () => {
    renderWithProviders(
      <Toasts toasts={[{ id: 1, code: 'note-lost', tone: 'error', text: 'Note lost.' }]} />,
    )

    const icon = screen.getByRole('button', { name: 'Note lost.' }).querySelector('svg')

    expect(icon?.getAttribute('class')).toContain('lucide-circle-x')
  })
})
