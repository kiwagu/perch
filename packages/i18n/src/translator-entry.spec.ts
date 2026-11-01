import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  createTranslator,
  DEFAULT_LOCALE,
  matchLocale,
  SUPPORTED_LOCALES,
} from '@workspace/i18n/translator'

describe('@workspace/i18n/translator', () => {
  it('offers the translator and the languages', () => {
    const t = createTranslator({ en: { 'mail.hello': 'Hello {name}' } }, 'es')

    expect(t('mail.hello', { name: 'Ann' })).toBe('Hello Ann')
    expect(SUPPORTED_LOCALES).toEqual(['en', 'es'])
    expect(DEFAULT_LOCALE).toBe('en')
    expect(matchLocale('es-AR')).toBe('es')
  })
  it('loads no React: the module it names imports nothing but its own code', () => {
    const exported = readFileSync(join(import.meta.dirname, 'translator.ts'), 'utf8')

    expect(exported).not.toMatch(/from ['"]react/)
    expect(exported).not.toMatch(/from ['"]\.\/provider/)
  })
})
