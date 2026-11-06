// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import en from '../../../../../platform/i18n/app.en.json'
import { renderWithProviders } from '../../../../../test-utils'

import { StatusLine } from './status-line.view'

describe('StatusLine', () => {
  it.each([
    ['ready', 'app.shell.sync.local'],
    ['opening', 'app.shell.starting'],
    ['opening-data', 'app.shell.opening-db'],
    ['failed', 'app.shell.failed'],
    ['start-failed', 'app.shell.start-failed'],
    ['storage-blocked', 'app.shell.storage-blocked'],
  ] as const)('says where the start is in one status line: %s', (status, key) => {
    renderWithProviders(<StatusLine status={status} />)

    const line = screen.getByTestId('app-shell.status')

    expect(line.getAttribute('data-state')).toBe(status)
    expect(line.getAttribute('role')).toBe('status')
    expect(line.textContent).toBe(en[key])
  })

  it("is visually hidden once ready, and seen while a signed-in account's data opens", () => {
    const { rerender } = renderWithProviders(<StatusLine status="ready" />)

    expect(screen.getByTestId('app-shell.status').className).toContain('sr-only')

    rerender(<StatusLine status="opening-data" />)

    expect(screen.getByTestId('app-shell.status').className).not.toContain('sr-only')
  })
})
