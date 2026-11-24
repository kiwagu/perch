// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'

import { NoticeLine } from './notice-line.view'

describe('NoticeLine', () => {
  it('announces the current notice with its code', () => {
    renderWithProviders(<NoticeLine notice={{ code: 'welcome', text: 'Welcome' }} />)

    const notice = screen.getByTestId('app-shell.notice-message')

    expect(notice.getAttribute('data-code')).toBe('welcome')
    expect(notice.textContent).toBe('Welcome')
    expect(notice.getAttribute('role')).toBe('status')
  })

  it("keeps the notice's line while there is no notice, so the page does not move", () => {
    const { container, rerender } = renderWithProviders(<NoticeLine />)
    const slot = container.querySelector('[data-slot="notice"]')

    expect(slot).not.toBeNull()
    expect(screen.queryByTestId('app-shell.notice-message')).toBeNull()

    rerender(<NoticeLine notice={{ code: 'welcome', text: 'Welcome' }} />)

    expect(container.querySelector('[data-slot="notice"]')).toBe(slot)
    expect(slot?.contains(screen.getByTestId('app-shell.notice-message'))).toBe(true)
  })
})
