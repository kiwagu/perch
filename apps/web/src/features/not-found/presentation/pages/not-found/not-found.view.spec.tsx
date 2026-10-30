// @vitest-environment jsdom
import { screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { renderWithProviders } from '../../../../../test-utils'
import es from '../../i18n/not-found.es.json'

import { NotFoundView } from './not-found.view'

describe('NotFoundView', () => {
  it('says no page is here and leads a guest to sign in', () => {
    renderWithProviders(<NotFoundView signedIn={false} />)

    expect(screen.getByTestId('not-found.page.heading').textContent).toBe('Page not found')
    expect(screen.getByTestId('not-found.page.sign-in-link').getAttribute('href')).toBe('/sign-in')
    expect(screen.queryByTestId('not-found.page.profile-link')).toBeNull()
  })

  it('leads a signed-in account to its profile, in the language it speaks', () => {
    renderWithProviders(<NotFoundView signedIn />, { locale: 'es', es })

    expect(screen.getByTestId('not-found.page.heading').textContent).toBe('Página no encontrada')
    expect(screen.getByTestId('not-found.page.profile-link').getAttribute('href')).toBe('/me')
    expect(screen.queryByTestId('not-found.page.sign-in-link')).toBeNull()
  })
})
