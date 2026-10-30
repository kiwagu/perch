// @vitest-environment jsdom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { createFormats, type Formats } from './formats'
import { I18nProvider, useFormats, useLocale, useT } from './provider'

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

  it('gives components the formats of the current language, in the time zone it is given', () => {
    const moment = new Date('2026-10-29T23:30:00Z')

    function Moment() {
      return <p data-testid="moment">{useFormats().dateTime(moment)}</p>
    }

    render(
      <I18nProvider locale="es" catalogs={{ en: {}, es: {} }} timeZone="Asia/Tokyo">
        <Moment />
      </I18nProvider>,
    )

    expect(screen.getByTestId('moment').textContent).toBe(
      createFormats('es', 'Asia/Tokyo').dateTime(moment),
    )
  })

  it('keeps the same formats until the language or the time zone changes', () => {
    const catalogs = { en: {}, es: {} }
    const seen: Formats[] = []

    function Probe() {
      seen.push(useFormats())

      return null
    }

    const { rerender } = render(
      <I18nProvider locale="en" catalogs={catalogs} timeZone="UTC">
        <Probe />
      </I18nProvider>,
    )

    rerender(
      <I18nProvider locale="en" catalogs={catalogs} timeZone="UTC">
        <Probe />
      </I18nProvider>,
    )
    rerender(
      <I18nProvider locale="en" catalogs={catalogs} timeZone="Asia/Tokyo">
        <Probe />
      </I18nProvider>,
    )
    rerender(
      <I18nProvider locale="es" catalogs={catalogs} timeZone="Asia/Tokyo">
        <Probe />
      </I18nProvider>,
    )

    expect(seen[1]).toBe(seen[0])
    expect(seen[2]).not.toBe(seen[1])
    expect(seen[3]).not.toBe(seen[2])
  })
})
