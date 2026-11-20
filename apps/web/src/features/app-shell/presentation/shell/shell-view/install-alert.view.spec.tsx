// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { InstallAlert } from './install-alert.view'

describe('InstallAlert', () => {
  it('reminds to install the app with its button and later, each while the flow takes it', () => {
    const onInstall = vi.fn()
    const onPostponeInstall = vi.fn()

    renderWithProviders(
      <InstallAlert
        install="install-available"
        can={() => true}
        onInstall={onInstall}
        onPostponeInstall={onPostponeInstall}
      />,
    )

    const message = screen.getByTestId('app-shell.install-message')

    expect(message.getAttribute('data-code')).toBe('install-available')
    expect(message.textContent).toBe(en['app.shell.install.available'])

    fireEvent.click(screen.getByTestId('app-shell.install-button'))
    fireEvent.click(screen.getByTestId('app-shell.install-later-button'))

    expect(onInstall).toHaveBeenCalledOnce()
    expect(onPostponeInstall).toHaveBeenCalledOnce()
  })

  it('shows the steps that install the app with later and no install button, in Spanish too', () => {
    renderWithProviders(
      <InstallAlert
        install="install-by-steps"
        can={(event) => event.type !== 'app-shell.install-later-button'}
      />,
      { locale: 'es', es },
    )

    expect(screen.getByTestId('app-shell.install-message').textContent).toBe(
      es['app.shell.install.by-steps'],
    )
    expect(screen.queryByTestId('app-shell.install-button')).toBeNull()
    expect(screen.getByTestId('app-shell.install-later-button').hasAttribute('disabled')).toBe(true)
  })

  it('enables each button exactly while the flow takes its own event', () => {
    renderWithProviders(
      <InstallAlert
        install="install-available"
        can={(event) => event.type === 'app-shell.install-button'}
      />,
    )

    expect(screen.getByTestId('app-shell.install-button').hasAttribute('disabled')).toBe(false)
    expect(screen.getByTestId('app-shell.install-later-button').hasAttribute('disabled')).toBe(true)
  })
})
