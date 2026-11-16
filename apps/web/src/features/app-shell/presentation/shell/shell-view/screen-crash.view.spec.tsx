// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import { renderWithProviders } from '../../../../../test-utils'

import { ScreenCrash, type ScreenCrashProps } from './screen-crash.view'

describe('ScreenCrash', () => {
  it('says a screen failed to render, with a reload while the flow takes one', () => {
    const onReload = vi.fn()
    const crash = (props: Partial<ScreenCrashProps>) => (
      <ScreenCrash crash="screen-crashed" reload={true} onReload={onReload} {...props} />
    )
    const { rerender } = renderWithProviders(crash({ canReload: true }))
    const message = screen.getByTestId('app-shell.crash-message')

    expect(message.getAttribute('data-code')).toBe('screen-crashed')
    expect(message.textContent).toBe(en['app.shell.crash.screen-crashed'])

    fireEvent.click(screen.getByTestId('app-shell.reload-button'))

    expect(onReload).toHaveBeenCalledOnce()

    rerender(crash({ canReload: false }))

    expect(screen.getByTestId('app-shell.reload-button').hasAttribute('disabled')).toBe(true)
  })

  it("shows no reload where the frame's state renders none", () => {
    renderWithProviders(<ScreenCrash crash="screen-crashed" reload={false} />)

    expect(screen.getByTestId('app-shell.crash-message')).toBeTruthy()
    expect(screen.queryByTestId('app-shell.reload-button')).toBeNull()
  })
})
