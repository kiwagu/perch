// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { Locale } from '@workspace/i18n'

import { expectFieldFacts, renderWithFacts } from '../../../../../field-facts.test-support'
import en from '../../i18n/organisation.en.json'
import es from '../../i18n/organisation.es.json'

import { OrganisationDefaultLanguage } from './organisation-default-language.view'

/**
 * The organisation's default language, for an admin: a select of the supported languages that shows
 * none while the organisation has none, the button that removes it while one is set, and the error
 * of the last change refused.
 */

afterEach(() => cleanup())

function renderControl(
  props: {
    readonly locale?: Locale | undefined
    readonly error?: string | undefined
    readonly can?: () => boolean
  } = {},
) {
  const onChoose = vi.fn()
  const onClear = vi.fn()
  const view = renderWithFacts(
    <OrganisationDefaultLanguage
      locale={props.locale}
      error={props.error}
      can={props.can ?? (() => true)}
      onChoose={onChoose}
      onClear={onClear}
    />,
    { locale: 'en', es },
  )

  return { ...view, onChoose, onClear }
}

describe('OrganisationDefaultLanguage', () => {
  it('shows no language and no clear button while the organisation has none', () => {
    renderControl()

    const select = screen.getByTestId('organisation.settings.locale-select')

    expect(select.hasAttribute('data-value')).toBe(false)
    expect(select.textContent).toContain(en['organisation.default-language.none'])
    expect(screen.queryByTestId('organisation.settings.clear-button')).toBeNull()
  })

  it('shows the language set, with the button that removes it', async () => {
    const { onClear } = renderControl({ locale: 'es' })

    expect(
      screen.getByTestId('organisation.settings.locale-select').getAttribute('data-value'),
    ).toBe('es')

    await userEvent.click(screen.getByTestId('organisation.settings.clear-button'))

    expect(onClear).toHaveBeenCalledOnce()
  })

  it('reports the language chosen', async () => {
    const { onChoose } = renderControl()

    await userEvent.click(screen.getByTestId('organisation.settings.locale-select'))

    const spanish = (
      await screen.findAllByTestId('organisation.settings.locale-select.option')
    ).find((item) => item.getAttribute('data-value') === 'es') as HTMLElement

    // The list takes no pointer until it has finished opening.
    await vi.waitFor(() => expect(getComputedStyle(spanish).pointerEvents).not.toBe('none'))
    await userEvent.click(spanish)

    expect(onChoose).toHaveBeenCalledWith('es')
  })

  it('takes no choice while the flow takes none', () => {
    renderControl({ can: () => false, locale: 'en' })

    expect(
      screen.getByTestId('organisation.settings.locale-select').hasAttribute('data-disabled'),
    ).toBe(true)
    expect(
      (screen.getByTestId('organisation.settings.clear-button') as HTMLButtonElement).disabled,
    ).toBe(true)
  })

  it('says a refusal by its contract code: forbidden for the rule, failed otherwise', () => {
    const { rerender } = renderControl({ error: 'organisation_settings:FORBIDDEN' })
    const error = () => screen.getByTestId('organisation.settings.error')

    expect(error().getAttribute('data-code')).toBe('forbidden')
    expect(error().textContent).toBe(en['organisation.error.settings-forbidden'])

    rerender(
      <OrganisationDefaultLanguage
        locale={undefined}
        error="data:WRITE_FAILED"
        can={() => true}
        onChoose={() => {}}
        onClear={() => {}}
      />,
    )

    expect(error().getAttribute('data-code')).toBe('failed')
  })

  it('holds its select to what the facts say of it', () => {
    const { container } = renderControl({ locale: 'en' })

    expect(expectFieldFacts(container)).toContain('organisation.settings.locale-select')
    expect(within(container).queryByTestId('organisation.settings.error')).toBeNull()
  })
})
