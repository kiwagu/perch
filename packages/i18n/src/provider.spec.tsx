// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { I18nProvider, useLocale, useT } from './provider'

function Label() {
  const t = useT()

  return <p>{`${useLocale()}: ${t('a.b')}`}</p>
}

describe('I18nProvider', () => {
  it('gives components the translator of the current language', () => {
    render(
      <I18nProvider locale="es" catalogs={{ en: { 'a.b': 'Save' }, es: { 'a.b': 'Guardar' } }}>
        <Label />
      </I18nProvider>,
    )

    expect(screen.getByText('es: Guardar')).toBeTruthy()
  })
})
