import { type RenderResult, render } from '@testing-library/react'
import type { ReactElement } from 'react'

import { FakeShapeRunner } from '@workspace/data/testing'
import { Container } from '@workspace/di'
import { type Catalog, I18nProvider, type Locale } from '@workspace/i18n'

import { englishCatalog } from './platform/catalogs'
import { ServicesProvider } from './platform/services'

export interface RenderOptions {
  readonly locale?: Locale
  readonly es?: Catalog
  readonly runner?: FakeShapeRunner
  readonly container?: Container
}

/** Renders a component with the application's providers: English text, in-memory ports. */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const services = {
    container: options.container ?? new Container(),
    runner: options.runner ?? new FakeShapeRunner(),
  }
  const catalogs = { en: englishCatalog, ...(options.es ? { es: options.es } : {}) }

  return render(
    <I18nProvider locale={options.locale ?? 'en'} catalogs={catalogs}>
      <ServicesProvider services={services}>{ui}</ServicesProvider>
    </I18nProvider>,
  )
}
