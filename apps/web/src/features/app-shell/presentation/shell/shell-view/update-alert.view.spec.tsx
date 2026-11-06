// @vitest-environment jsdom
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import es from '../../../../../platform/i18n/app.es.json'
import { renderWithProviders } from '../../../../../test-utils'

import { UpdateAlert } from './update-alert.view'

describe('UpdateAlert', () => {
  it('says a newer build is served, with a reload while the flow takes one', () => {
    const onUpdate = vi.fn()

    renderWithProviders(<UpdateAlert update="new-version" canUpdate={true} onUpdate={onUpdate} />)

    const message = screen.getByTestId('app-shell.update-message')

    expect(message.getAttribute('data-code')).toBe('new-version')
    expect(message.textContent).toBe(en['app.shell.update.new-version'])

    fireEvent.click(screen.getByTestId('app-shell.update-button'))

    expect(onUpdate).toHaveBeenCalledOnce()
  })

  it('says a protocol the server no longer takes, its reload held while the flow takes none', () => {
    renderWithProviders(
      <UpdateAlert update="protocol-outdated" canUpdate={false} onUpdate={() => {}} />,
      { locale: 'es', es },
    )

    const message = screen.getByTestId('app-shell.update-message')

    expect(message.getAttribute('data-code')).toBe('protocol-outdated')
    expect(message.textContent).toBe(es['app.shell.update.protocol-outdated'])
    expect(screen.getByTestId('app-shell.update-button').hasAttribute('disabled')).toBe(true)
  })
})
