import { type RenderResult, render } from '@testing-library/react'
import type { ReactElement, ReactNode } from 'react'

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

/**
 * Renders a component with the application's providers: English text, in-memory ports. The
 * providers wrap the component, so `rerender` with new props keeps them.
 */
export function renderWithProviders(ui: ReactElement, options: RenderOptions = {}): RenderResult {
  const services = {
    container: options.container ?? new Container(),
    runner: options.runner ?? new FakeShapeRunner(),
  }
  const catalogs = { en: englishCatalog, ...(options.es ? { es: options.es } : {}) }

  return render(ui, {
    wrapper: ({ children }: { readonly children: ReactNode }) => (
      <I18nProvider locale={options.locale ?? 'en'} catalogs={catalogs}>
        <ServicesProvider services={services}>{children}</ServicesProvider>
      </I18nProvider>
    ),
  })
}
